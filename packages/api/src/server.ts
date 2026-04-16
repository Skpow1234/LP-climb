import Fastify from "fastify";
import sensible from "@fastify/sensible";
import etag from "@fastify/etag";
import rateLimit from "@fastify/rate-limit";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import { z } from "zod";
import { loadEnv } from "./env.js";
import { createMemoryCache } from "./cache.js";
import { listPresets, PRESET_IDS, resolveDims } from "./presets.js";
import {
  httpRequestDurationSeconds,
  httpRequestsTotal,
  recordCacheEvent,
  recordGithubFetch,
  renderMetrics
} from "./metrics.js";
import { fetchGithubContributionCells, isGithubContribError } from "@lp-climb/github-contrib";
import { computeStats } from "@lp-climb/core";
import { getTheme, listThemes } from "@lp-climb/themes";
import {
  renderRankedClimbAvif,
  renderRankedClimbGif,
  renderRankedClimbPng,
  renderRankedClimbSvg,
  renderRankedClimbWebp
} from "@lp-climb/svg-creator";

const env = loadEnv();
const cache = createMemoryCache({ maxEntries: env.CACHE_MAX_ENTRIES });

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
  crossOriginEmbedderPolicy: false
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

// Echo the request id back to callers for log correlation. Done in onRequest
// so it's present even on early 4xx / rate-limit responses.
app.addHook("onRequest", async (req, reply) => {
  reply.header("X-Request-Id", req.id);
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

app.get("/healthz", async () => ({ ok: true }));
app.get("/v1/healthz", async () => ({ ok: true, version: "v1" }));

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

type ContribCacheSource = "hit" | "stale" | "miss";

type ResolvedClimbers = {
  primary: { cells: unknown[]; stamp: number };
  vs: { user: string; cells: unknown[]; stamp: number } | null;
  team: Array<{ user: string; cells: unknown[]; stamp: number }>;
};

// Shared fan-out for primary + optional vs + optional team. Team entries
// matching the primary user are dropped (the renderer would draw a duplicate
// marker otherwise). All fetches run in parallel.
async function resolveClimbers(q: {
  user: string;
  vs?: string | undefined;
  team?: string[] | undefined;
}): Promise<ResolvedClimbers> {
  const teamLogins = (q.team ?? []).filter((t) => t.toLowerCase() !== q.user.toLowerCase());

  const [primary, vs, ...teamResults] = await Promise.all([
    getContribCellsSWR(q.user),
    q.vs ? getContribCellsSWR(q.vs) : Promise.resolve(null),
    ...teamLogins.map((t) => getContribCellsSWR(t))
  ]);

  return {
    primary: { cells: primary.cells, stamp: primary.stamp },
    vs: q.vs && vs ? { user: q.vs, cells: vs.cells, stamp: vs.stamp } : null,
    team: teamLogins.map((user, i) => ({
      user,
      cells: teamResults[i]!.cells,
      stamp: teamResults[i]!.stamp
    }))
  };
}

async function getContribCellsSWR(user: string): Promise<{
  cells: unknown[];
  stamp: number;
  stale: boolean;
  source: ContribCacheSource;
}> {
  const key = JSON.stringify({ v: 1, kind: "contrib", user });
  const hit = cache.get(key);

  if (hit.hit && !hit.stale) {
    recordCacheEvent("contrib", "hit");
    return {
      cells: JSON.parse(hit.value) as unknown[],
      stamp: hit.storedAtMs,
      stale: false,
      source: "hit"
    };
  }

  if (hit.hit && hit.stale) {
    recordCacheEvent("contrib", "stale");
    // Serve stale immediately, refresh in background.
    void (async () => {
      try {
        const fresh = await fetchGithubContributionCells({ user, githubToken: env.GITHUB_TOKEN });
        recordGithubFetch("success");
        cache.set(key, JSON.stringify(fresh), env.CACHE_TTL_SECONDS, env.CACHE_STALE_SECONDS);
      } catch (e) {
        // Keep stale.
        recordGithubFetch("error");
        app.log.warn({ err: e }, "contrib refresh failed (serving stale)");
      }
    })();

    return {
      cells: JSON.parse(hit.value) as unknown[],
      stamp: hit.storedAtMs,
      stale: true,
      source: "stale"
    };
  }

  recordCacheEvent("contrib", "miss");
  try {
    const fresh = await fetchGithubContributionCells({ user, githubToken: env.GITHUB_TOKEN });
    recordGithubFetch("success");
    cache.set(key, JSON.stringify(fresh), env.CACHE_TTL_SECONDS, env.CACHE_STALE_SECONDS);
    return { cells: fresh as unknown[], stamp: Date.now(), stale: false, source: "miss" };
  } catch (e) {
    recordGithubFetch("error");
    throw e;
  }
}

// Builds the shared `RenderParams` passed to every rasterizer / encoder. Owns
// the `vs` vs `team` precedence (vs wins when both are set, matching the
// schema-level refinement which already rejects the combination).
function buildRenderParams(
  q: { user: string },
  theme: any,
  dims: { width?: number; height?: number },
  climbers: ResolvedClimbers
) {
  const primaryStats = computeStats(climbers.primary.cells as any);
  const vs = climbers.vs
    ? {
        user: climbers.vs.user,
        cells: climbers.vs.cells as any,
        stats: computeStats(climbers.vs.cells as any)
      }
    : null;
  const team = climbers.team.map((m) => ({
    user: m.user,
    cells: m.cells as any,
    stats: computeStats(m.cells as any)
  }));

  return {
    user: q.user,
    cells: climbers.primary.cells as any,
    stats: primaryStats,
    theme,
    ...(dims.width !== undefined ? { width: dims.width } : {}),
    ...(dims.height !== undefined ? { height: dims.height } : {}),
    ...(vs ? { vs } : {}),
    ...(team.length > 0 ? { team } : {})
  };
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
    v: 1,
    route: "v1/render.svg",
    user: q.user,
    vs: climbers.vs?.user ?? null,
    team: climbers.team.map((t) => t.user),
    stampA: climbers.primary.stamp,
    stampB: climbers.vs?.stamp ?? null,
    stampsTeam: climbers.team.map((t) => t.stamp),
    theme: theme.id,
    width: dims.width ?? null,
    height: dims.height ?? null
  });

  const cached = cache.get(cacheKey);
  if (cached.hit) {
    recordCacheEvent("render", cached.stale ? "stale" : "hit");
    reply.header("Content-Type", "image/svg+xml; charset=utf-8");
    reply.header("Cache-Control", cacheControl);
    reply.header("X-Cache", cached.stale ? "stale" : "hit");
    if (opts?.deprecated) {
      reply.header("Deprecation", "true");
      reply.header("Sunset", "2026-12-31");
      reply.header("Link", '</v1/render.svg>; rel="successor-version"');
    }
    return cached.value;
  }
  recordCacheEvent("render", "miss");

  const svg = renderRankedClimbSvg(buildRenderParams(q, theme, dims, climbers));

  cache.set(cacheKey, svg, env.CACHE_TTL_SECONDS, env.CACHE_STALE_SECONDS);

  reply.header("Content-Type", "image/svg+xml; charset=utf-8");
  reply.header("Cache-Control", cacheControl);
  reply.header("X-Cache", "miss");
  if (opts?.deprecated) {
    reply.header("Deprecation", "true");
    reply.header("Sunset", "2026-12-31");
    reply.header("Link", '</v1/render.svg>; rel="successor-version"');
  }
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
    v: 1,
    route: "v1/render.png",
    user: q.user,
    vs: climbers.vs?.user ?? null,
    team: climbers.team.map((t) => t.user),
    stampA: climbers.primary.stamp,
    stampB: climbers.vs?.stamp ?? null,
    stampsTeam: climbers.team.map((t) => t.stamp),
    theme: theme.id,
    width: dims.width ?? null,
    height: dims.height ?? null
  });

  const cached = cache.get(cacheKey);
  if (cached.hit) {
    recordCacheEvent("render", cached.stale ? "stale" : "hit");
    reply.header("Content-Type", "image/png");
    reply.header("Cache-Control", cacheControl);
    reply.header("X-Cache", cached.stale ? "stale" : "hit");
    if (opts?.deprecated) {
      reply.header("Deprecation", "true");
      reply.header("Sunset", "2026-12-31");
      reply.header("Link", '</v1/render.png>; rel="successor-version"');
    }
    return Buffer.from(cached.value, "base64");
  }
  recordCacheEvent("render", "miss");

  const png = renderRankedClimbPng(buildRenderParams(q, theme, dims, climbers));

  cache.set(cacheKey, png.toString("base64"), env.CACHE_TTL_SECONDS, env.CACHE_STALE_SECONDS);

  reply.header("Content-Type", "image/png");
  reply.header("Cache-Control", cacheControl);
  reply.header("X-Cache", "miss");
  if (opts?.deprecated) {
    reply.header("Deprecation", "true");
    reply.header("Sunset", "2026-12-31");
    reply.header("Link", '</v1/render.png>; rel="successor-version"');
  }
  return png;
};

type RasterFormat = "webp" | "avif";

const handleRenderRaster = async (req: any, reply: any, format: RasterFormat) => {
  const q = RasterQuerySchema.parse(req.query);
  const theme = applyThemeOverrides(getTheme(q.theme ?? null), q);
  const dims = resolveDims(q);

  const climbers = await resolveClimbers(q);

  const cacheKey = JSON.stringify({
    v: 1,
    route: `v1/render.${format}`,
    user: q.user,
    vs: climbers.vs?.user ?? null,
    team: climbers.team.map((t) => t.user),
    stampA: climbers.primary.stamp,
    stampB: climbers.vs?.stamp ?? null,
    stampsTeam: climbers.team.map((t) => t.stamp),
    theme: theme.id,
    width: dims.width ?? null,
    height: dims.height ?? null,
    quality: q.quality ?? null
  });

  const contentType = format === "webp" ? "image/webp" : "image/avif";

  const cached = cache.get(cacheKey);
  if (cached.hit) {
    recordCacheEvent("render", cached.stale ? "stale" : "hit");
    reply.header("Content-Type", contentType);
    reply.header("Cache-Control", cacheControl);
    reply.header("X-Cache", cached.stale ? "stale" : "hit");
    return Buffer.from(cached.value, "base64");
  }
  recordCacheEvent("render", "miss");

  const params = buildRenderParams(q, theme, dims, climbers);
  const encoderOpts = q.quality !== undefined ? { quality: q.quality } : {};

  const buf =
    format === "webp"
      ? await renderRankedClimbWebp(params, encoderOpts)
      : await renderRankedClimbAvif(params, encoderOpts);

  cache.set(cacheKey, buf.toString("base64"), env.CACHE_TTL_SECONDS, env.CACHE_STALE_SECONDS);

  reply.header("Content-Type", contentType);
  reply.header("Cache-Control", cacheControl);
  reply.header("X-Cache", "miss");
  return buf;
};

const handleRenderGif = async (req: any, reply: any) => {
  const q = GifQuerySchema.parse(req.query);
  const theme = applyThemeOverrides(getTheme(q.theme ?? null), q);
  const dims = resolveDims(q);

  const climbers = await resolveClimbers(q);

  const cacheKey = JSON.stringify({
    v: 1,
    route: "v1/render.gif",
    user: q.user,
    vs: climbers.vs?.user ?? null,
    team: climbers.team.map((t) => t.user),
    stampA: climbers.primary.stamp,
    stampB: climbers.vs?.stamp ?? null,
    stampsTeam: climbers.team.map((t) => t.stamp),
    theme: theme.id,
    width: dims.width ?? null,
    height: dims.height ?? null,
    frames: q.frames ?? null,
    fps: q.fps ?? null
  });

  const cached = cache.get(cacheKey);
  if (cached.hit) {
    recordCacheEvent("render", cached.stale ? "stale" : "hit");
    reply.header("Content-Type", "image/gif");
    reply.header("Cache-Control", cacheControl);
    reply.header("X-Cache", cached.stale ? "stale" : "hit");
    return Buffer.from(cached.value, "base64");
  }
  recordCacheEvent("render", "miss");

  const gif = renderRankedClimbGif(buildRenderParams(q, theme, dims, climbers), {
    ...(q.frames !== undefined ? { frames: q.frames } : {}),
    ...(q.fps !== undefined ? { fps: q.fps } : {})
  });

  cache.set(cacheKey, gif.toString("base64"), env.CACHE_TTL_SECONDS, env.CACHE_STALE_SECONDS);

  reply.header("Content-Type", "image/gif");
  reply.header("Cache-Control", cacheControl);
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
    v: 1,
    route: "v1/meta.json",
    user: q.user,
    vs: climbers.vs?.user ?? null,
    team: climbers.team.map((t) => t.user),
    stampA: climbers.primary.stamp,
    stampB: climbers.vs?.stamp ?? null,
    stampsTeam: climbers.team.map((t) => t.stamp)
  });
  const cached = cache.get(cacheKey);
  if (cached.hit) {
    recordCacheEvent("render", cached.stale ? "stale" : "hit");
    reply.header("Content-Type", "application/json; charset=utf-8");
    reply.header("Cache-Control", cacheControl);
    reply.header("X-Cache", cached.stale ? "stale" : "hit");
    if (opts?.deprecated) {
      reply.header("Deprecation", "true");
      reply.header("Sunset", "2026-12-31");
      reply.header("Link", '</v1/meta.json>; rel="successor-version"');
    }
    return cached.value;
  }
  recordCacheEvent("render", "miss");

  const body = JSON.stringify({
    user: q.user,
    stats: computeStats(climbers.primary.cells as any),
    vs: climbers.vs ? { user: climbers.vs.user, stats: computeStats(climbers.vs.cells as any) } : null,
    team: climbers.team.map((m) => ({ user: m.user, stats: computeStats(m.cells as any) }))
  });

  cache.set(cacheKey, body, env.CACHE_TTL_SECONDS, env.CACHE_STALE_SECONDS);
  reply.header("Content-Type", "application/json; charset=utf-8");
  reply.header("Cache-Control", cacheControl);
  reply.header("X-Cache", "miss");
  if (opts?.deprecated) {
    reply.header("Deprecation", "true");
    reply.header("Sunset", "2026-12-31");
    reply.header("Link", '</v1/meta.json>; rel="successor-version"');
  }
  return body;
};

// v1 endpoints
app.get("/v1/render.svg", (req, reply) => handleRenderSvg(req, reply));
app.get("/v1/render.png", (req, reply) => handleRenderPng(req, reply));
app.get("/v1/render.gif", (req, reply) => handleRenderGif(req, reply));
app.get("/v1/render.webp", (req, reply) => handleRenderRaster(req, reply, "webp"));
app.get("/v1/render.avif", (req, reply) => handleRenderRaster(req, reply, "avif"));
app.get("/v1/meta.json", (req, reply) => handleMetaJson(req, reply));
app.get("/v1/github-contrib/:user", async (req, reply) => {
  // Edge-friendly proxy: returns normalized contribution cells for clients
  // that cannot (or do not want to) call the GitHub GraphQL API themselves.
  // Shares the SWR LRU with the render endpoints, so a request here warms the
  // cache for subsequent render calls (and vice versa).
  const params = z
    .object({ user: GithubLoginSchema })
    .parse((req as any).params);
  const result = await getContribCellsSWR(params.user);

  reply.header("Content-Type", "application/json; charset=utf-8");
  reply.header("Cache-Control", cacheControl);
  reply.header("X-Cache", result.source);

  return {
    user: params.user,
    fetchedAt: new Date(result.stamp).toISOString(),
    stale: result.stale,
    days: (result.cells as unknown[]).length,
    cells: result.cells
  };
});

app.get("/v1/themes.json", async (_req, reply) => {
  reply.header("Content-Type", "application/json; charset=utf-8");
  reply.header("Cache-Control", "public, max-age=3600");
  return JSON.stringify({ themes: listThemes() });
});
app.get("/v1/presets.json", async (_req, reply) => {
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
app.get("/metrics", metricsHandler);
app.get("/v1/metrics", metricsHandler);

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

  const status =
    (err as any).statusCode && Number.isInteger((err as any).statusCode) ? (err as any).statusCode : 500;
  reply.status(status).send({
    error: status === 500 ? "internal_error" : "bad_request",
    message: status === 500 ? "Unexpected error" : (err as any).message
  });
});

app.listen({ port: env.PORT, host: env.HOST });

