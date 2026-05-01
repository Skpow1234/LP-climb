import Fastify from "fastify";
import sensible from "@fastify/sensible";
import etag from "@fastify/etag";
import rateLimit from "@fastify/rate-limit";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { z } from "zod";
import type { ContributionCell, ContributionStats } from "@lp-climb/types";
import type { LpTimelinePoint } from "@lp-climb/core";
import { loadEnv } from "./env.js";
import { createCoalescer, createMemoryCache } from "./cache.js";
import { buildDeterministicEtag, ifNoneMatchMatches } from "./etag.js";
import { listPresets, PRESET_IDS, resolveDims } from "./presets.js";
import { themeFingerprint } from "./themeFingerprint.js";
import { OPENAPI_INFO, OPENAPI_TAGS, SCHEMAS } from "./openapi.js";
import {
  httpRequestDurationSeconds,
  httpRequestsTotal,
  recordCacheEvent,
  recordGithubFetch,
  renderMetrics
} from "./metrics.js";
import { fetchGithubContributionCells, isGithubContribError } from "@lp-climb/github-contrib";
import { computeLpTimeline, computeStats } from "@lp-climb/core";
import { getTheme, listThemes } from "@lp-climb/themes";
import {
  renderRankedClimbAvif,
  renderRankedClimbGif,
  renderRankedClimbPng,
  renderRankedClimbSvg,
  renderRankedClimbWebp
} from "@lp-climb/svg-creator";

const env = loadEnv();

type ContribData = {
  cells: ContributionCell[];
  stats: ContributionStats;
  timeline: LpTimelinePoint[];
};

function estimateTextBytes(value: string, key: string) {
  return Buffer.byteLength(key, "utf8") + Buffer.byteLength(value, "utf8");
}

function estimateBinaryBytes(value: Buffer, key: string) {
  return Buffer.byteLength(key, "utf8") + value.byteLength;
}

function estimateContribBytes(value: ContribData, key: string) {
  // Contribution cells are compact fixed-shape records. This estimate is
  // intentionally conservative so large user sets age out before they push
  // out a disproportionate amount of binary render data.
  const cellsBytes = value.cells.length * 40;
  const statsBytes = 128;
  const timelineBytes = value.timeline.length * 24;
  return Buffer.byteLength(key, "utf8") + cellsBytes + statsBytes + timelineBytes;
}

// Three LRUs, one per hot value-shape:
//   - `contribCache` holds typed contribution cells + precomputed stats.
//   - `textCache` holds SVG / JSON / Prometheus text.
//   - `binaryCache` holds raw `Buffer`s for PNG / WebP / AVIF / GIF.
//
// Each cache is bounded by both entry count and an approximate byte budget.
// That keeps a burst of large GIFs / AVIFs from evicting the much smaller,
// much hotter contribution and SVG entries too aggressively.
const contribCache = createMemoryCache<ContribData>({
  maxEntries: env.CACHE_MAX_ENTRIES,
  maxSize: env.CACHE_CONTRIB_MAX_BYTES,
  sizeCalculation: estimateContribBytes
});
const textCache = createMemoryCache<string>({
  maxEntries: env.CACHE_MAX_ENTRIES,
  maxSize: env.CACHE_TEXT_MAX_BYTES,
  sizeCalculation: estimateTextBytes
});
const binaryCache = createMemoryCache<Buffer>({
  maxEntries: env.CACHE_MAX_ENTRIES,
  maxSize: env.CACHE_BINARY_MAX_BYTES,
  sizeCalculation: estimateBinaryBytes
});

type ContribCacheSource = "hit" | "stale" | "miss";
type ContribFetchResult = {
  data: ContribData;
  stamp: number;
  stale: boolean;
  source: ContribCacheSource;
};

// In-flight request coalescers. See `cache.ts` for the pattern — on a cold
// miss, the first caller per key does the upstream work and concurrent
// callers piggy-back on the same promise. Drops cache-stampede-induced
// GraphQL quota burn to O(unique users) instead of O(concurrent requests).
const contribCoalesce = createCoalescer<string, ContribFetchResult>();
const renderTextCoalesce = createCoalescer<string, string>();
const renderBinaryCoalesce = createCoalescer<string, Buffer>();

const app = Fastify({
  logger: true,
  trustProxy: true,
  bodyLimit: 1024,
  // Request ID correlation: honor an incoming X-Request-Id (typical of
  // reverse proxies / CDNs), otherwise generate one. Surfaced on every log
  // line as `reqId` and echoed back as an `X-Request-Id` response header.
  requestIdHeader: "x-request-id",
  requestIdLogLabel: "reqId",
  genReqId: () =>
    // Small, URL-safe, collision-resistant. Not cryptographically strong —
    // that's fine for a correlation ID.
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
});

await app.register(sensible);
await app.register(etag);
await app.register(helmet, {
  // We embed SVGs in iframes and GitHub READMEs; avoid overly strict defaults that could break embedding.
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  // Helmet defaults CORP to `same-origin`, which blocks `<img src="lp-climb...">`
  // embedded on any other origin (profile READMEs, github.io demo pages). The
  // render API is explicitly designed to be embedded anywhere, so we relax
  // CORP to `cross-origin` by default. Configurable via CROSS_ORIGIN_RESOURCE_POLICY.
  crossOriginResourcePolicy: { policy: env.CROSS_ORIGIN_RESOURCE_POLICY }
});

// CORS. The public read-only render API is designed to be embeddable from
// anywhere (profile READMEs, third-party dashboards, etc.), so the default
// allow-list is `*`. Operators can lock it down to an allow-list by setting
// `CORS_ALLOW_ORIGINS=https://a.example.com,https://b.example.com`, or
// disable CORS entirely (no `Access-Control-*` headers) with an empty value.
const corsAllowOrigins = env.CORS_ALLOW_ORIGINS.trim();
if (corsAllowOrigins.length > 0) {
  const parsedOrigins = corsAllowOrigins
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  const origin: boolean | string[] = parsedOrigins.includes("*") ? true : parsedOrigins;
  await app.register(cors, {
    origin,
    credentials: env.CORS_ALLOW_CREDENTIALS,
    methods: ["GET", "HEAD", "OPTIONS"],
    // Headers we emit that a browser-side client may want to inspect.
    exposedHeaders: [
      "X-Cache",
      "X-Request-Id",
      "Deprecation",
      "Sunset",
      "Link",
      "RateLimit-Limit",
      "RateLimit-Remaining",
      "RateLimit-Reset",
      "Retry-After"
    ],
    maxAge: 86400
  });
}

await app.register(rateLimit, {
  max: env.RATE_LIMIT_MAX,
  timeWindow: env.RATE_LIMIT_TIME_WINDOW_SECONDS * 1000
});

// OpenAPI / Swagger UI.
//
// We treat the route `schema` entries as documentation only — Zod remains
// the single source of truth for runtime request validation. Without this
// override Fastify would build an Ajv validator from the JSON Schema we
// pass to each route and reject valid requests (e.g. the Zod `TeamSchema`
// accepts a comma-separated string and pipes it through to an array, which
// Ajv can't express cleanly). The Zod `.parse()` calls in each handler
// catch the same cases with better error messages.
app.setValidatorCompiler(() => () => true);

await app.register(swagger, {
  openapi: {
    openapi: "3.0.3",
    info: OPENAPI_INFO,
    servers: [
      { url: "https://lp-climb.onrender.com", description: "Production (Render)" },
      { url: "http://localhost:3000", description: "Local development" }
    ],
    tags: OPENAPI_TAGS as unknown as Array<{ name: string; description: string }>
  },
  // Hide the `/metrics` alias (we document `/v1/metrics` instead) and any
  // route that didn't opt into a schema — keeps the catalog tight.
  hideUntagged: true
});

await app.register(swaggerUi, {
  routePrefix: "/docs",
  uiConfig: {
    docExpansion: "list",
    deepLinking: true,
    displayRequestDuration: true,
    tryItOutEnabled: true
  },
  staticCSP: false
});

// Canonical, stable URL for the raw OpenAPI document. `@fastify/swagger-ui`
// already serves it at `/docs/json`, but API consumers expect `/openapi.json`
// and it lets us keep the UI-prefix free to change. Hidden from the catalog
// itself to avoid a meta entry.
app.get("/openapi.json", { schema: { hide: true } }, async (_req, reply) => {
  reply.header("Content-Type", "application/json; charset=utf-8");
  reply.header("Cache-Control", "public, max-age=300");
  return app.swagger();
});

// Echo the request id back to callers for log correlation. Done in onRequest
// so it's present even on early 4xx / rate-limit responses.
app.addHook("onRequest", async (req, reply) => {
  reply.header("X-Request-Id", req.id);
});

// Make sure every render / meta response carries the configured CORP header,
// even if a future plugin overrides helmet's default. Image endpoints are the
// ones most commonly embedded cross-origin (profile READMEs, github.io).
app.addHook("onSend", async (req, reply, payload) => {
  const route =
    (req as any).routeOptions?.url ||
    (req as any).routerPath ||
    req.url.split("?")[0] ||
    "";
  if (
    route.startsWith("/v1/render.") ||
    route === "/v1/meta.json" ||
    route.startsWith("/render.") ||
    route === "/meta.json"
  ) {
    reply.header("Cross-Origin-Resource-Policy", env.CROSS_ORIGIN_RESOURCE_POLICY);
  }
  return payload;
});

// Per-route metrics + structured timing log. `routeOptions.url` keeps label
// cardinality bounded (e.g. `/v1/github-contrib/:user` rather than each user).
app.addHook("onResponse", async (req, reply) => {
  const route =
    (req as any).routeOptions?.url ||
    (req as any).routerPath ||
    req.url.split("?")[0] ||
    "unknown";
  const method = req.method;
  const status = String(reply.statusCode);
  const durationSeconds = reply.elapsedTime / 1000;

  httpRequestsTotal.labels(method, route, status).inc();
  httpRequestDurationSeconds.labels(method, route, status).observe(durationSeconds);

  req.log.info(
    {
      reqId: req.id,
      method,
      route,
      status: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime * 100) / 100
    },
    "request completed"
  );
});

// `/healthz` is the legacy alias; keep it undocumented (implicit via
// `hideUntagged`) so the catalog only surfaces the versioned route.
app.get("/healthz", async () => ({ ok: true }));
app.get("/v1/healthz", { schema: SCHEMAS.healthz }, async () => ({ ok: true, version: "v1" }));

const cacheControl = `public, max-age=${env.CACHE_TTL_SECONDS}, stale-while-revalidate=${env.CACHE_STALE_SECONDS}`;

const ColorSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((s) => /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s) || /^rgba?\([^)]+\)$/.test(s), {
    message: "invalid color (expected hex like #RRGGBB or rgb()/rgba())"
  });

const GithubLoginSchema = z
  .string()
  .min(1)
  .max(39)
  .regex(/^(?!-)(?!.*--)[a-zA-Z0-9-]{1,39}(?<!-)$/, "invalid github username");

// Cap total climbers (primary + team) to keep fan-out against the GitHub API
// bounded per request. 6 is the width of the team-marker palette.
const MAX_TEAM_SIZE = 5;

// Parse `?team=a,b,c` into a de-duplicated array of logins. Empty / whitespace
// entries are dropped. Returns `undefined` when the input is absent/blank so
// downstream code can distinguish "no team" from "empty team".
const TeamSchema = z
  .string()
  .optional()
  .transform((v) => {
    if (!v) return undefined;
    const parts = v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) return undefined;
    return Array.from(new Set(parts));
  })
  .pipe(
    z
      .array(GithubLoginSchema)
      .min(1, "team must include at least one username")
      .max(MAX_TEAM_SIZE, `team may include at most ${MAX_TEAM_SIZE} usernames (excluding the primary user)`)
      .optional()
  );

// Base object schema; `.extend()` / `.pick()` require a ZodObject, so the
// vs+team mutual-exclusion rule is applied as a separate refinement below and
// re-applied when extending (Gif / Raster schemas).
const RenderQueryObject = z.object({
  user: GithubLoginSchema,
  theme: z.string().optional(),
  width: z.coerce.number().int().min(500).max(2000).optional(),
  height: z.coerce.number().int().min(180).max(900).optional(),
  // Named dimension preset (e.g. `readme`, `banner`). Explicit width/height
  // always override the preset's values.
  preset: z.enum(PRESET_IDS as [string, ...string[]]).optional(),
  // Visualization style. `card` (default) renders the profile tier card;
  // `ladder` renders the legacy horizontal climb ladder. `vs` / `team` modes
  // require `ladder`; card mode renders the primary user only.
  style: z.enum(["card", "ladder"]).optional(),
  vs: GithubLoginSchema.optional(),
  // Team mode: comma-separated extra GitHub logins to render on the same
  // ladder as additional climbers. Mutually exclusive with `vs` (see
  // `vsTeamRefinement`). Duplicates and the primary user are de-duplicated
  // server-side.
  team: TeamSchema,

  // Optional theme overrides (for “champion select” personalization).
  // Example: &accent=%23ff00aa&tier_challenger=%23ffd36b
  bg: ColorSchema.optional(),
  frame: ColorSchema.optional(),
  text: ColorSchema.optional(),
  accent: ColorSchema.optional(),
  glow: ColorSchema.optional(),
  tier_iron: ColorSchema.optional(),
  tier_bronze: ColorSchema.optional(),
  tier_silver: ColorSchema.optional(),
  tier_gold: ColorSchema.optional(),
  tier_plat: ColorSchema.optional(),
  tier_emerald: ColorSchema.optional(),
  tier_diamond: ColorSchema.optional(),
  tier_master: ColorSchema.optional(),
  tier_grandmaster: ColorSchema.optional(),
  tier_challenger: ColorSchema.optional()
});

const vsTeamRefinement = {
  check: (q: { vs?: string | undefined; team?: string[] | undefined }) =>
    !(q.vs && q.team && q.team.length > 0),
  message: "cannot combine `vs` and `team` — pass one or the other",
  path: ["team"] as ["team"]
};

const RenderQuerySchema = RenderQueryObject.refine(vsTeamRefinement.check, {
  message: vsTeamRefinement.message,
  path: vsTeamRefinement.path
});

const GifQuerySchema = RenderQueryObject.extend({
  // GIFs are expensive; keep width/height tighter defaults but allow the full
  // render range. These clamps are enforced again inside the encoder.
  frames: z.coerce.number().int().min(6).max(60).optional(),
  fps: z.coerce.number().int().min(4).max(30).optional()
}).refine(vsTeamRefinement.check, {
  message: vsTeamRefinement.message,
  path: vsTeamRefinement.path
});

const RasterQuerySchema = RenderQueryObject.extend({
  // Shared schema for WebP / AVIF endpoints.
  quality: z.coerce.number().int().min(1).max(100).optional()
}).refine(vsTeamRefinement.check, {
  message: vsTeamRefinement.message,
  path: vsTeamRefinement.path
});

function applyThemeOverrides(base: any, q: any) {
  const out = structuredClone(base) as any;
  if (q.bg) out.bg = q.bg;
  if (q.frame) out.frame = q.frame;
  if (q.text) out.text = q.text;
  if (q.accent) out.accent = q.accent;
  if (q.glow) out.glow = q.glow;

  const tierMap: Record<string, string> = {
    iron: q.tier_iron,
    bronze: q.tier_bronze,
    silver: q.tier_silver,
    gold: q.tier_gold,
    plat: q.tier_plat,
    emerald: q.tier_emerald,
    diamond: q.tier_diamond,
    master: q.tier_master,
    grandmaster: q.tier_grandmaster,
    challenger: q.tier_challenger
  };
  for (const k of Object.keys(tierMap)) {
    const v = tierMap[k];
    if (v) out.tier[k] = v;
  }

  return out;
}

type ResolvedClimbers = {
  primary: { user: string; data: ContribData; stamp: number };
  vs: { user: string; data: ContribData; stamp: number } | null;
  team: Array<{ user: string; data: ContribData; stamp: number }>;
};

// Shared fan-out for primary + optional vs + optional team. Team entries
// matching the primary user are dropped (the renderer would draw a duplicate
// marker otherwise). All fetches run in parallel.
async function resolveClimbers(q: {
  user: string;
  vs?: string | undefined;
  team?: string[] | undefined;
}, opts?: { allowStale?: boolean | undefined }): Promise<ResolvedClimbers> {
  const allowStale = opts?.allowStale ?? true;
  const teamLogins = (q.team ?? []).filter((t) => t.toLowerCase() !== q.user.toLowerCase());

  const [primary, vs, ...teamResults] = await Promise.all([
    getContribCellsSWR(q.user, { allowStale }),
    q.vs ? getContribCellsSWR(q.vs, { allowStale }) : Promise.resolve(null),
    ...teamLogins.map((t) => getContribCellsSWR(t, { allowStale }))
  ]);

  return {
    primary: { user: q.user, data: primary.data, stamp: primary.stamp },
    vs: q.vs && vs ? { user: q.vs, data: vs.data, stamp: vs.stamp } : null,
    team: teamLogins.map((user, i) => ({
      user,
      data: teamResults[i]!.data,
      stamp: teamResults[i]!.stamp
    }))
  };
}

async function refreshContrib(user: string): Promise<ContribFetchResult> {
  const key = JSON.stringify({ v: 1, kind: "contrib", user });
  const freshCells = await fetchGithubContributionCells({ user, githubToken: env.GITHUB_TOKEN });
  recordGithubFetch("success");
  const data: ContribData = {
    cells: freshCells,
    stats: computeStats(freshCells),
    timeline: computeLpTimeline(freshCells)
  };
  contribCache.set(key, data, env.CACHE_TTL_SECONDS, env.CACHE_STALE_SECONDS);
  return { data, stamp: Date.now(), stale: false, source: "miss" };
}

async function getContribCellsSWR(
  user: string,
  opts?: { allowStale?: boolean | undefined }
): Promise<ContribFetchResult> {
  const key = JSON.stringify({ v: 1, kind: "contrib", user });
  const hit = contribCache.get(key);
  const allowStale = opts?.allowStale ?? true;

  // Fresh hit: no upstream call, no coalescing needed.
  if (hit.hit && !hit.stale) {
    recordCacheEvent("contrib", "hit");
    return {
      data: hit.value,
      stamp: hit.storedAtMs,
      stale: false,
      source: "hit"
    };
  }

  // Stale hit: return the stale value immediately and kick off exactly one
  // background refresh per key (coalesced). Subsequent stale-hit callers
  // observe the same in-flight refresh instead of each spawning their own.
  if (hit.hit && hit.stale) {
    recordCacheEvent("contrib", "stale");
    if (allowStale) {
      void contribCoalesce(key, async () => {
        try {
          return await refreshContrib(user);
        } catch (e) {
          recordGithubFetch("error");
          app.log.warn({ err: e, user }, "contrib refresh failed (serving stale)");
          throw e;
        }
      }).catch(() => {
        /* already logged; stale entry stays in cache */
      });

      return {
        data: hit.value,
        stamp: hit.storedAtMs,
        stale: true,
        source: "stale"
      };
    }

    return contribCoalesce(key, async () => {
      const raced = contribCache.get(key);
      if (raced.hit && !raced.stale) {
        return {
          data: raced.value,
          stamp: raced.storedAtMs,
          stale: false,
          source: "hit"
        };
      }
      try {
        return await refreshContrib(user);
      } catch (e) {
        recordGithubFetch("error");
        throw e;
      }
    });
  }

  // Cold miss: coalesce concurrent callers onto one GitHub fetch.
  recordCacheEvent("contrib", "miss");
  return contribCoalesce(key, async () => {
    // Re-check the cache under the coalescer: a sibling request that won the
    // race may have just populated it, turning this into a fresh hit.
    const raced = contribCache.get(key);
    if (raced.hit && !raced.stale) {
      return {
        data: raced.value,
        stamp: raced.storedAtMs,
        stale: false,
        source: "hit"
      };
    }
    try {
      return await refreshContrib(user);
    } catch (e) {
      recordGithubFetch("error");
      throw e;
    }
  });
}

// Builds the shared `RenderParams` passed to every rasterizer / encoder. Owns
// the `vs` vs `team` precedence (vs wins when both are set, matching the
// schema-level refinement which already rejects the combination).
function buildRenderParams(
  // `q` and `dims` come from Zod `.optional()` fields, which under the
  // project's `exactOptionalPropertyTypes: true` produce `T | undefined` rather
  // than "possibly omitted". Accept `undefined` explicitly so the call sites
  // can pass the parsed query object straight through without narrowing.
  q: { user: string; style?: "card" | "ladder" | undefined },
  theme: any,
  dims: { width?: number | undefined; height?: number | undefined },
  climbers: ResolvedClimbers
) {
  const vs = climbers.vs
    ? {
        user: climbers.vs.user,
        cells: climbers.vs.data.cells,
        stats: climbers.vs.data.stats,
        timeline: climbers.vs.data.timeline
      }
    : null;
  const team = climbers.team.map((m) => ({
    user: m.user,
    cells: m.data.cells,
    stats: m.data.stats,
    timeline: m.data.timeline
  }));

  // Card mode is primary-only: silently ignore `vs` / `team` so the request
  // doesn't 400 and the renderer output stays clean. Ladder mode forwards
  // everything.
  const style: "card" | "ladder" = q.style ?? "card";
  const forwardVs = style === "ladder" && vs;
  const forwardTeam = style === "ladder" && team.length > 0;

  return {
    user: q.user,
    cells: climbers.primary.data.cells,
    stats: climbers.primary.data.stats,
    timeline: climbers.primary.data.timeline,
    theme,
    style,
    ...(dims.width !== undefined ? { width: dims.width } : {}),
    ...(dims.height !== undefined ? { height: dims.height } : {}),
    ...(forwardVs ? { vs } : {}),
    ...(forwardTeam ? { team } : {})
  };
}

function refreshTextCacheInBackground(cacheKey: string, route: string, run: () => Promise<string>) {
  void renderTextCoalesce(cacheKey, async () => {
    try {
      const out = await run();
      textCache.set(cacheKey, out, env.CACHE_TTL_SECONDS, env.CACHE_STALE_SECONDS);
      return out;
    } catch (err) {
      app.log.warn({ err, route }, "background text cache refresh failed");
      throw err;
    }
  }).catch(() => {
    /* already logged; stale entry stays in cache */
  });
}

function refreshBinaryCacheInBackground(cacheKey: string, route: string, run: () => Promise<Buffer>) {
  void renderBinaryCoalesce(cacheKey, async () => {
    try {
      const out = await run();
      binaryCache.set(cacheKey, out, env.CACHE_TTL_SECONDS, env.CACHE_STALE_SECONDS);
      return out;
    } catch (err) {
      app.log.warn({ err, route }, "background binary cache refresh failed");
      throw err;
    }
  }).catch(() => {
    /* already logged; stale entry stays in cache */
  });
}

const handleRenderSvg = async (
  req: any,
  reply: any,
  opts?: { deprecated?: boolean }
) => {
  const q = RenderQuerySchema.parse(req.query);
  const theme = applyThemeOverrides(getTheme(q.theme ?? null), q);
  const dims = resolveDims(q);

  const climbers = await resolveClimbers(q);

  const cacheKey = JSON.stringify({
    v: 2,
    route: "v1/render.svg",
    user: q.user,
    vs: climbers.vs?.user ?? null,
    team: climbers.team.map((t) => t.user),
    stampA: climbers.primary.stamp,
    stampB: climbers.vs?.stamp ?? null,
    stampsTeam: climbers.team.map((t) => t.stamp),
    theme: themeFingerprint(theme),
    width: dims.width ?? null,
    height: dims.height ?? null,
    style: q.style ?? "card"
  });
  const etag = buildDeterministicEtag(cacheKey);

  const cached = textCache.get(cacheKey);
  reply.header("ETag", etag);
  reply.header("Cache-Control", cacheControl);
  if (opts?.deprecated) {
    reply.header("Deprecation", "true");
    reply.header("Sunset", "2026-12-31");
    reply.header("Link", '</v1/render.svg>; rel="successor-version"');
  }
  if (ifNoneMatchMatches(req.headers["if-none-match"], etag)) {
    reply.header("X-Cache", cached.hit ? (cached.stale ? "stale" : "hit") : "miss");
    reply.code(304);
    return "";
  }
  if (cached.hit) {
    recordCacheEvent("render", cached.stale ? "stale" : "hit");
    if (cached.stale) {
      refreshTextCacheInBackground(cacheKey, "v1/render.svg", async () => {
        const freshClimbers = await resolveClimbers(q, { allowStale: false });
        return renderRankedClimbSvg(buildRenderParams(q, theme, dims, freshClimbers));
      });
    }
    reply.header("Content-Type", "image/svg+xml; charset=utf-8");
    reply.header("X-Cache", cached.stale ? "stale" : "hit");
    return cached.value;
  }
  recordCacheEvent("render", "miss");

  // Coalesce concurrent misses for the same key — avoids N parallel renders
  // of the same SVG when a hot artifact is first requested by a swarm.
  const svg = await renderTextCoalesce(cacheKey, async () => {
    const raced = textCache.get(cacheKey);
    if (raced.hit && !raced.stale) return raced.value;
    const out = renderRankedClimbSvg(buildRenderParams(q, theme, dims, climbers));
    textCache.set(cacheKey, out, env.CACHE_TTL_SECONDS, env.CACHE_STALE_SECONDS);
    return out;
  });

  reply.header("Content-Type", "image/svg+xml; charset=utf-8");
  reply.header("X-Cache", "miss");
  return svg;
};

const handleRenderPng = async (
  req: any,
  reply: any,
  opts?: { deprecated?: boolean }
) => {
  const q = RenderQuerySchema.parse(req.query);
  const theme = applyThemeOverrides(getTheme(q.theme ?? null), q);
  const dims = resolveDims(q);

  const climbers = await resolveClimbers(q);

  const cacheKey = JSON.stringify({
    v: 2,
    route: "v1/render.png",
    user: q.user,
    vs: climbers.vs?.user ?? null,
    team: climbers.team.map((t) => t.user),
    stampA: climbers.primary.stamp,
    stampB: climbers.vs?.stamp ?? null,
    stampsTeam: climbers.team.map((t) => t.stamp),
    theme: themeFingerprint(theme),
    width: dims.width ?? null,
    height: dims.height ?? null,
    style: q.style ?? "card"
  });
  const etag = buildDeterministicEtag(cacheKey);

  const cached = binaryCache.get(cacheKey);
  reply.header("ETag", etag);
  reply.header("Cache-Control", cacheControl);
  if (opts?.deprecated) {
    reply.header("Deprecation", "true");
    reply.header("Sunset", "2026-12-31");
    reply.header("Link", '</v1/render.png>; rel="successor-version"');
  }
  if (ifNoneMatchMatches(req.headers["if-none-match"], etag)) {
    reply.header("X-Cache", cached.hit ? (cached.stale ? "stale" : "hit") : "miss");
    reply.code(304);
    return "";
  }
  if (cached.hit) {
    recordCacheEvent("render", cached.stale ? "stale" : "hit");
    if (cached.stale) {
      refreshBinaryCacheInBackground(cacheKey, "v1/render.png", async () => {
        const freshClimbers = await resolveClimbers(q, { allowStale: false });
        return renderRankedClimbPng(buildRenderParams(q, theme, dims, freshClimbers));
      });
    }
    reply.header("Content-Type", "image/png");
    reply.header("X-Cache", cached.stale ? "stale" : "hit");
    return cached.value;
  }
  recordCacheEvent("render", "miss");

  const png = await renderBinaryCoalesce(cacheKey, async () => {
    const raced = binaryCache.get(cacheKey);
    if (raced.hit && !raced.stale) return raced.value;
    const out = renderRankedClimbPng(buildRenderParams(q, theme, dims, climbers));
    binaryCache.set(cacheKey, out, env.CACHE_TTL_SECONDS, env.CACHE_STALE_SECONDS);
    return out;
  });

  reply.header("Content-Type", "image/png");
  reply.header("X-Cache", "miss");
  return png;
};

type RasterFormat = "webp" | "avif";

const handleRenderRaster = async (req: any, reply: any, format: RasterFormat) => {
  const q = RasterQuerySchema.parse(req.query);
  const theme = applyThemeOverrides(getTheme(q.theme ?? null), q);
  const dims = resolveDims(q);

  const climbers = await resolveClimbers(q);

  const cacheKey = JSON.stringify({
    v: 2,
    route: `v1/render.${format}`,
    user: q.user,
    vs: climbers.vs?.user ?? null,
    team: climbers.team.map((t) => t.user),
    stampA: climbers.primary.stamp,
    stampB: climbers.vs?.stamp ?? null,
    stampsTeam: climbers.team.map((t) => t.stamp),
    theme: themeFingerprint(theme),
    width: dims.width ?? null,
    height: dims.height ?? null,
    quality: q.quality ?? null,
    style: q.style ?? "card"
  });

  const contentType = format === "webp" ? "image/webp" : "image/avif";
  const etag = buildDeterministicEtag(cacheKey);

  const cached = binaryCache.get(cacheKey);
  reply.header("ETag", etag);
  reply.header("Cache-Control", cacheControl);
  if (ifNoneMatchMatches(req.headers["if-none-match"], etag)) {
    reply.header("X-Cache", cached.hit ? (cached.stale ? "stale" : "hit") : "miss");
    reply.code(304);
    return "";
  }
  if (cached.hit) {
    recordCacheEvent("render", cached.stale ? "stale" : "hit");
    if (cached.stale) {
      refreshBinaryCacheInBackground(cacheKey, `v1/render.${format}`, async () => {
        const freshClimbers = await resolveClimbers(q, { allowStale: false });
        const params = buildRenderParams(q, theme, dims, freshClimbers);
        const encoderOpts = q.quality !== undefined ? { quality: q.quality } : {};
        return format === "webp"
          ? await renderRankedClimbWebp(params, encoderOpts)
          : await renderRankedClimbAvif(params, encoderOpts);
      });
    }
    reply.header("Content-Type", contentType);
    reply.header("X-Cache", cached.stale ? "stale" : "hit");
    return cached.value;
  }
  recordCacheEvent("render", "miss");

  const buf = await renderBinaryCoalesce(cacheKey, async () => {
    const raced = binaryCache.get(cacheKey);
    if (raced.hit && !raced.stale) return raced.value;
    const params = buildRenderParams(q, theme, dims, climbers);
    const encoderOpts = q.quality !== undefined ? { quality: q.quality } : {};
    const out =
      format === "webp"
        ? await renderRankedClimbWebp(params, encoderOpts)
        : await renderRankedClimbAvif(params, encoderOpts);
    binaryCache.set(cacheKey, out, env.CACHE_TTL_SECONDS, env.CACHE_STALE_SECONDS);
    return out;
  });

  reply.header("Content-Type", contentType);
  reply.header("X-Cache", "miss");
  return buf;
};

const handleRenderGif = async (req: any, reply: any) => {
  const q = GifQuerySchema.parse(req.query);
  const theme = applyThemeOverrides(getTheme(q.theme ?? null), q);
  const dims = resolveDims(q);

  const climbers = await resolveClimbers(q);

  const cacheKey = JSON.stringify({
    v: 2,
    route: "v1/render.gif",
    user: q.user,
    vs: climbers.vs?.user ?? null,
    team: climbers.team.map((t) => t.user),
    stampA: climbers.primary.stamp,
    stampB: climbers.vs?.stamp ?? null,
    stampsTeam: climbers.team.map((t) => t.stamp),
    theme: themeFingerprint(theme),
    width: dims.width ?? null,
    height: dims.height ?? null,
    frames: q.frames ?? null,
    fps: q.fps ?? null,
    style: q.style ?? "card"
  });
  const etag = buildDeterministicEtag(cacheKey);

  const cached = binaryCache.get(cacheKey);
  reply.header("ETag", etag);
  reply.header("Cache-Control", cacheControl);
  if (ifNoneMatchMatches(req.headers["if-none-match"], etag)) {
    reply.header("X-Cache", cached.hit ? (cached.stale ? "stale" : "hit") : "miss");
    reply.code(304);
    return "";
  }
  if (cached.hit) {
    recordCacheEvent("render", cached.stale ? "stale" : "hit");
    if (cached.stale) {
      refreshBinaryCacheInBackground(cacheKey, "v1/render.gif", async () => {
        const freshClimbers = await resolveClimbers(q, { allowStale: false });
        return renderRankedClimbGif(buildRenderParams(q, theme, dims, freshClimbers), {
          ...(q.frames !== undefined ? { frames: q.frames } : {}),
          ...(q.fps !== undefined ? { fps: q.fps } : {})
        });
      });
    }
    reply.header("Content-Type", "image/gif");
    reply.header("X-Cache", cached.stale ? "stale" : "hit");
    return cached.value;
  }
  recordCacheEvent("render", "miss");

  const gif = await renderBinaryCoalesce(cacheKey, async () => {
    const raced = binaryCache.get(cacheKey);
    if (raced.hit && !raced.stale) return raced.value;
    const out = renderRankedClimbGif(buildRenderParams(q, theme, dims, climbers), {
      ...(q.frames !== undefined ? { frames: q.frames } : {}),
      ...(q.fps !== undefined ? { fps: q.fps } : {})
    });
    binaryCache.set(cacheKey, out, env.CACHE_TTL_SECONDS, env.CACHE_STALE_SECONDS);
    return out;
  });

  reply.header("Content-Type", "image/gif");
  reply.header("X-Cache", "miss");
  return gif;
};

const handleMetaJson = async (
  req: any,
  reply: any,
  opts?: { deprecated?: boolean }
) => {
  const q = RenderQueryObject.pick({ user: true, vs: true, team: true })
    .refine(vsTeamRefinement.check, {
      message: vsTeamRefinement.message,
      path: vsTeamRefinement.path
    })
    .parse(req.query);
  const climbers = await resolveClimbers(q);

  const cacheKey = JSON.stringify({
    v: 2,
    route: "v1/meta.json",
    user: q.user,
    vs: climbers.vs?.user ?? null,
    team: climbers.team.map((t) => t.user),
    stampA: climbers.primary.stamp,
    stampB: climbers.vs?.stamp ?? null,
    stampsTeam: climbers.team.map((t) => t.stamp)
  });
  const etag = buildDeterministicEtag(cacheKey);
  const cached = textCache.get(cacheKey);
  reply.header("ETag", etag);
  reply.header("Cache-Control", cacheControl);
  if (opts?.deprecated) {
    reply.header("Deprecation", "true");
    reply.header("Sunset", "2026-12-31");
    reply.header("Link", '</v1/meta.json>; rel="successor-version"');
  }
  if (ifNoneMatchMatches(req.headers["if-none-match"], etag)) {
    reply.header("X-Cache", cached.hit ? (cached.stale ? "stale" : "hit") : "miss");
    reply.code(304);
    return "";
  }
  if (cached.hit) {
    recordCacheEvent("render", cached.stale ? "stale" : "hit");
    if (cached.stale) {
      refreshTextCacheInBackground(cacheKey, "v1/meta.json", async () => {
        const freshClimbers = await resolveClimbers(q, { allowStale: false });
        return JSON.stringify({
          user: q.user,
          stats: freshClimbers.primary.data.stats,
          vs: freshClimbers.vs
            ? { user: freshClimbers.vs.user, stats: freshClimbers.vs.data.stats }
            : null,
          team: freshClimbers.team.map((m) => ({ user: m.user, stats: m.data.stats }))
        });
      });
    }
    reply.header("Content-Type", "application/json; charset=utf-8");
    reply.header("X-Cache", cached.stale ? "stale" : "hit");
    return cached.value;
  }
  recordCacheEvent("render", "miss");

  const body = await renderTextCoalesce(cacheKey, async () => {
    const raced = textCache.get(cacheKey);
    if (raced.hit && !raced.stale) return raced.value;
    const out = JSON.stringify({
      user: q.user,
      stats: climbers.primary.data.stats,
      vs: climbers.vs
        ? { user: climbers.vs.user, stats: climbers.vs.data.stats }
        : null,
      team: climbers.team.map((m) => ({ user: m.user, stats: m.data.stats }))
    });
    textCache.set(cacheKey, out, env.CACHE_TTL_SECONDS, env.CACHE_STALE_SECONDS);
    return out;
  });

  reply.header("Content-Type", "application/json; charset=utf-8");
  reply.header("X-Cache", "miss");
  return body;
};

// v1 endpoints
app.get("/v1/render.svg", { schema: SCHEMAS.renderSvg }, (req, reply) =>
  handleRenderSvg(req, reply)
);
app.get("/v1/render.png", { schema: SCHEMAS.renderPng }, (req, reply) =>
  handleRenderPng(req, reply)
);
app.get("/v1/render.gif", { schema: SCHEMAS.renderGif }, (req, reply) =>
  handleRenderGif(req, reply)
);
app.get("/v1/render.webp", { schema: SCHEMAS.renderWebp }, (req, reply) =>
  handleRenderRaster(req, reply, "webp")
);
app.get("/v1/render.avif", { schema: SCHEMAS.renderAvif }, (req, reply) =>
  handleRenderRaster(req, reply, "avif")
);
app.get("/v1/meta.json", { schema: SCHEMAS.metaJson }, (req, reply) =>
  handleMetaJson(req, reply)
);
app.get("/v1/github-contrib/:user", { schema: SCHEMAS.githubContrib }, async (req, reply) => {
  // Edge-friendly proxy: returns normalized contribution cells for clients
  // that cannot (or do not want to) call the GitHub GraphQL API themselves.
  // Shares the SWR LRU with the render endpoints, so a request here warms the
  // cache for subsequent render calls (and vice versa).
  const params = z
    .object({ user: GithubLoginSchema })
    .parse((req as any).params);
  const result = await getContribCellsSWR(params.user);
  const etag = buildDeterministicEtag(
    JSON.stringify({
      v: 1,
      route: "v1/github-contrib/:user",
      user: params.user,
      stamp: result.stamp,
      stale: result.stale
    })
  );

  reply.header("ETag", etag);
  reply.header("Content-Type", "application/json; charset=utf-8");
  reply.header("Cache-Control", cacheControl);
  reply.header("X-Cache", result.source);
  if (ifNoneMatchMatches(req.headers["if-none-match"], etag)) {
    reply.code(304);
    return "";
  }

  return {
    user: params.user,
    fetchedAt: new Date(result.stamp).toISOString(),
    stale: result.stale,
    days: result.data.cells.length,
    cells: result.data.cells
  };
});

app.get("/v1/themes.json", { schema: SCHEMAS.themes }, async (_req, reply) => {
  reply.header("Content-Type", "application/json; charset=utf-8");
  reply.header("Cache-Control", "public, max-age=3600");
  return JSON.stringify({ themes: listThemes() });
});
app.get("/v1/presets.json", { schema: SCHEMAS.presets }, async (_req, reply) => {
  reply.header("Content-Type", "application/json; charset=utf-8");
  reply.header("Cache-Control", "public, max-age=3600");
  return JSON.stringify({ presets: listPresets() });
});

// Prometheus text exposition. `/v1/metrics` is the canonical location; the
// unversioned `/metrics` alias exists because most scraper configs expect it
// and it avoids leaking a route name into scrape config templates.
const metricsHandler = async (_req: any, reply: any) => {
  const { body, contentType } = await renderMetrics();
  reply.header("Content-Type", contentType);
  reply.header("Cache-Control", "no-store");
  return body;
};
// `/metrics` is the canonical Prometheus scraper location; we keep it but
// leave it undocumented (one entry is plenty for the catalog). `/v1/metrics`
// is the one that appears in /docs.
app.get("/metrics", metricsHandler);
app.get("/v1/metrics", { schema: SCHEMAS.metrics }, metricsHandler);

// Legacy (unversioned) endpoints, kept for compatibility. All legacy render /
// meta routes emit RFC 8594 `Sunset` + `Deprecation` + `Link` headers; see
// `docs/api-compatibility.md` for the formal policy and sunset calendar.
app.get("/render.svg", (req, reply) => handleRenderSvg(req, reply, { deprecated: true }));
app.get("/render.png", (req, reply) => handleRenderPng(req, reply, { deprecated: true }));
app.get("/meta.json", (req, reply) => handleMetaJson(req, reply, { deprecated: true }));

app.setErrorHandler((err, _req, reply) => {
  app.log.error(err);
  if (isGithubContribError(err)) {
    reply.status(err.statusCode).send({
      error: err.code,
      message: err.message
    });
    return;
  }

  // Zod validation failures (thrown from inside handlers as `RenderQuerySchema.parse(...)`)
  // have no `statusCode`, so they used to fall through to the 500 branch. Surface them
  // as 400s with the first issue's message — matches what Swagger UI / typical HTTP
  // clients expect for bad query params.
  if (err instanceof z.ZodError) {
    const first = err.issues[0];
    reply.status(400).send({
      error: "bad_request",
      message: first
        ? `${first.path.length > 0 ? first.path.join(".") + ": " : ""}${first.message}`
        : "invalid request"
    });
    return;
  }

  const status =
    (err as any).statusCode && Number.isInteger((err as any).statusCode) ? (err as any).statusCode : 500;
  reply.status(status).send({
    error: status === 500 ? "internal_error" : "bad_request",
    message: status === 500 ? "Unexpected error" : (err as any).message
  });
});

// Graceful shutdown. On SIGTERM/SIGINT we stop accepting new connections
// (`app.close()`), let in-flight requests finish, and then exit cleanly.
// Render/Fly/Docker send SIGTERM on deploy; without this, upstream requests
// get RST during rollouts and caches don't drain to logs. A hard 10 s
// deadline avoids hangs if a handler is stuck.
let shuttingDown = false;
const gracefulShutdown = async (signal: NodeJS.Signals) => {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "shutdown initiated");
  const deadlineMs = 10_000;
  const kill = setTimeout(() => {
    app.log.error({ deadlineMs }, "shutdown deadline exceeded, exiting forcefully");
    process.exit(1);
  }, deadlineMs);
  kill.unref();
  try {
    await app.close();
    app.log.info("shutdown complete");
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, "shutdown failed");
    process.exit(1);
  }
};
process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => void gracefulShutdown("SIGINT"));

app.listen({ port: env.PORT, host: env.HOST });
