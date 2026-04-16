import Fastify from "fastify";
import sensible from "@fastify/sensible";
import etag from "@fastify/etag";
import rateLimit from "@fastify/rate-limit";
import helmet from "@fastify/helmet";
import { z } from "zod";
import { loadEnv } from "./env.js";
import { createMemoryCache } from "./cache.js";
import { listPresets, PRESET_IDS, resolveDims } from "./presets.js";
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
  bodyLimit: 1024
});

await app.register(sensible);
await app.register(etag);
await app.register(helmet, {
  // We embed SVGs in iframes and GitHub READMEs; avoid overly strict defaults that could break embedding.
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
});
await app.register(rateLimit, {
  max: env.RATE_LIMIT_MAX,
  timeWindow: env.RATE_LIMIT_TIME_WINDOW_SECONDS * 1000
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

const RenderQuerySchema = z.object({
  user: GithubLoginSchema,
  theme: z.string().optional(),
  width: z.coerce.number().int().min(500).max(2000).optional(),
  height: z.coerce.number().int().min(180).max(900).optional(),
  // Named dimension preset (e.g. `readme`, `banner`). Explicit width/height
  // always override the preset's values.
  preset: z.enum(PRESET_IDS as [string, ...string[]]).optional(),
  vs: GithubLoginSchema.optional(),

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

const GifQuerySchema = RenderQuerySchema.extend({
  // GIFs are expensive; keep width/height tighter defaults but allow the full
  // render range. These clamps are enforced again inside the encoder.
  frames: z.coerce.number().int().min(6).max(60).optional(),
  fps: z.coerce.number().int().min(4).max(30).optional()
});

const RasterQuerySchema = RenderQuerySchema.extend({
  // Shared schema for WebP / AVIF endpoints.
  quality: z.coerce.number().int().min(1).max(100).optional()
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

async function getContribCellsSWR(user: string) {
  const key = JSON.stringify({ v: 1, kind: "contrib", user });
  const hit = cache.get(key);

  if (hit.hit && !hit.stale) {
    return {
      cells: JSON.parse(hit.value) as unknown[],
      stamp: hit.storedAtMs,
      stale: false
    };
  }

  if (hit.hit && hit.stale) {
    // Serve stale immediately, refresh in background.
    void (async () => {
      try {
        const fresh = await fetchGithubContributionCells({ user, githubToken: env.GITHUB_TOKEN });
        cache.set(key, JSON.stringify(fresh), env.CACHE_TTL_SECONDS, env.CACHE_STALE_SECONDS);
      } catch (e) {
        // Keep stale.
        app.log.warn({ err: e }, "contrib refresh failed (serving stale)");
      }
    })();

    return {
      cells: JSON.parse(hit.value) as unknown[],
      stamp: hit.storedAtMs,
      stale: true
    };
  }

  const fresh = await fetchGithubContributionCells({ user, githubToken: env.GITHUB_TOKEN });
  cache.set(key, JSON.stringify(fresh), env.CACHE_TTL_SECONDS, env.CACHE_STALE_SECONDS);
  return { cells: fresh as unknown[], stamp: Date.now(), stale: false };
}

const handleRenderSvg = async (
  req: any,
  reply: any,
  opts?: { deprecated?: boolean }
) => {
  const q = RenderQuerySchema.parse(req.query);
  const theme = applyThemeOverrides(getTheme(q.theme ?? null), q);
  const dims = resolveDims(q);

  const [a, b] = await Promise.all([
    getContribCellsSWR(q.user),
    q.vs ? getContribCellsSWR(q.vs) : Promise.resolve(null)
  ]);

  const cacheKey = JSON.stringify({
    v: 1,
    route: "v1/render.svg",
    user: q.user,
    vs: q.vs ?? null,
    stampA: a.stamp,
    stampB: b?.stamp ?? null,
    theme: theme.id,
    width: dims.width ?? null,
    height: dims.height ?? null
  });

  const cached = cache.get(cacheKey);
  if (cached.hit) {
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

  const cellsA = a.cells as any[];
  const cellsB = b?.cells ?? null;
  const statsA = computeStats(cellsA as any);
  const statsB = cellsB ? computeStats(cellsB as any) : null;

  const svg = renderRankedClimbSvg({
    user: q.user,
    cells: cellsA as any,
    stats: statsA,
    theme,
    ...(dims.width !== undefined ? { width: dims.width } : {}),
    ...(dims.height !== undefined ? { height: dims.height } : {}),
    ...(q.vs && cellsB && statsB ? { vs: { user: q.vs, cells: cellsB as any, stats: statsB } } : {})
  });

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

const handleRenderPng = async (req: any, reply: any) => {
  const q = RenderQuerySchema.parse(req.query);
  const theme = applyThemeOverrides(getTheme(q.theme ?? null), q);
  const dims = resolveDims(q);

  const [a, b] = await Promise.all([
    getContribCellsSWR(q.user),
    q.vs ? getContribCellsSWR(q.vs) : Promise.resolve(null)
  ]);

  const cacheKey = JSON.stringify({
    v: 1,
    route: "v1/render.png",
    user: q.user,
    vs: q.vs ?? null,
    stampA: a.stamp,
    stampB: b?.stamp ?? null,
    theme: theme.id,
    width: dims.width ?? null,
    height: dims.height ?? null
  });

  const cached = cache.get(cacheKey);
  if (cached.hit) {
    reply.header("Content-Type", "image/png");
    reply.header("Cache-Control", cacheControl);
    reply.header("X-Cache", cached.stale ? "stale" : "hit");
    return Buffer.from(cached.value, "base64");
  }

  const cellsA = a.cells as any[];
  const cellsB = b?.cells ?? null;
  const statsA = computeStats(cellsA as any);
  const statsB = cellsB ? computeStats(cellsB as any) : null;

  const png = renderRankedClimbPng({
    user: q.user,
    cells: cellsA as any,
    stats: statsA,
    theme,
    ...(dims.width !== undefined ? { width: dims.width } : {}),
    ...(dims.height !== undefined ? { height: dims.height } : {}),
    ...(q.vs && cellsB && statsB ? { vs: { user: q.vs, cells: cellsB as any, stats: statsB } } : {})
  });

  cache.set(cacheKey, png.toString("base64"), env.CACHE_TTL_SECONDS, env.CACHE_STALE_SECONDS);

  reply.header("Content-Type", "image/png");
  reply.header("Cache-Control", cacheControl);
  reply.header("X-Cache", "miss");
  return png;
};

type RasterFormat = "webp" | "avif";

const handleRenderRaster = async (req: any, reply: any, format: RasterFormat) => {
  const q = RasterQuerySchema.parse(req.query);
  const theme = applyThemeOverrides(getTheme(q.theme ?? null), q);
  const dims = resolveDims(q);

  const [a, b] = await Promise.all([
    getContribCellsSWR(q.user),
    q.vs ? getContribCellsSWR(q.vs) : Promise.resolve(null)
  ]);

  const cacheKey = JSON.stringify({
    v: 1,
    route: `v1/render.${format}`,
    user: q.user,
    vs: q.vs ?? null,
    stampA: a.stamp,
    stampB: b?.stamp ?? null,
    theme: theme.id,
    width: dims.width ?? null,
    height: dims.height ?? null,
    quality: q.quality ?? null
  });

  const contentType = format === "webp" ? "image/webp" : "image/avif";

  const cached = cache.get(cacheKey);
  if (cached.hit) {
    reply.header("Content-Type", contentType);
    reply.header("Cache-Control", cacheControl);
    reply.header("X-Cache", cached.stale ? "stale" : "hit");
    return Buffer.from(cached.value, "base64");
  }

  const cellsA = a.cells as any[];
  const cellsB = b?.cells ?? null;
  const statsA = computeStats(cellsA as any);
  const statsB = cellsB ? computeStats(cellsB as any) : null;

  const params = {
    user: q.user,
    cells: cellsA as any,
    stats: statsA,
    theme,
    ...(dims.width !== undefined ? { width: dims.width } : {}),
    ...(dims.height !== undefined ? { height: dims.height } : {}),
    ...(q.vs && cellsB && statsB ? { vs: { user: q.vs, cells: cellsB as any, stats: statsB } } : {})
  };
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

  const [a, b] = await Promise.all([
    getContribCellsSWR(q.user),
    q.vs ? getContribCellsSWR(q.vs) : Promise.resolve(null)
  ]);

  const cacheKey = JSON.stringify({
    v: 1,
    route: "v1/render.gif",
    user: q.user,
    vs: q.vs ?? null,
    stampA: a.stamp,
    stampB: b?.stamp ?? null,
    theme: theme.id,
    width: dims.width ?? null,
    height: dims.height ?? null,
    frames: q.frames ?? null,
    fps: q.fps ?? null
  });

  const cached = cache.get(cacheKey);
  if (cached.hit) {
    reply.header("Content-Type", "image/gif");
    reply.header("Cache-Control", cacheControl);
    reply.header("X-Cache", cached.stale ? "stale" : "hit");
    return Buffer.from(cached.value, "base64");
  }

  const cellsA = a.cells as any[];
  const cellsB = b?.cells ?? null;
  const statsA = computeStats(cellsA as any);
  const statsB = cellsB ? computeStats(cellsB as any) : null;

  const gif = renderRankedClimbGif(
    {
      user: q.user,
      cells: cellsA as any,
      stats: statsA,
      theme,
      ...(dims.width !== undefined ? { width: dims.width } : {}),
      ...(dims.height !== undefined ? { height: dims.height } : {}),
      ...(q.vs && cellsB && statsB ? { vs: { user: q.vs, cells: cellsB as any, stats: statsB } } : {})
    },
    {
      ...(q.frames !== undefined ? { frames: q.frames } : {}),
      ...(q.fps !== undefined ? { fps: q.fps } : {})
    }
  );

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
  const q = RenderQuerySchema.pick({ user: true, vs: true }).parse(req.query);
  const [a, b] = await Promise.all([
    getContribCellsSWR(q.user),
    q.vs ? getContribCellsSWR(q.vs) : Promise.resolve(null)
  ]);

  const cacheKey = JSON.stringify({
    v: 1,
    route: "v1/meta.json",
    user: q.user,
    vs: q.vs ?? null,
    stampA: a.stamp,
    stampB: b?.stamp ?? null
  });
  const cached = cache.get(cacheKey);
  if (cached.hit) {
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

  const body = JSON.stringify({
    user: q.user,
    stats: computeStats(a.cells as any),
    vs: q.vs && b?.cells ? { user: q.vs, stats: computeStats(b.cells as any) } : null
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

// legacy (unversioned) endpoints, kept for compatibility
app.get("/render.svg", (req, reply) => handleRenderSvg(req, reply, { deprecated: true }));
app.get("/render.png", (req, reply) => handleRenderPng(req, reply));
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

