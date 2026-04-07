import Fastify from "fastify";
import sensible from "@fastify/sensible";
import etag from "@fastify/etag";
import rateLimit from "@fastify/rate-limit";
import helmet from "@fastify/helmet";
import { z } from "zod";
import { loadEnv } from "./env.js";
import { createMemoryCache } from "./cache.js";
import { fetchGithubContributionCells, isGithubContribError } from "@lp-climb/github-contrib";
import { computeStats } from "@lp-climb/core";
import { getTheme } from "@lp-climb/themes";
import { renderRankedClimbSvg } from "@lp-climb/svg-creator";

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
  vs: GithubLoginSchema.optional()
});

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
  const theme = getTheme(q.theme ?? null);

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
    width: q.width ?? null,
    height: q.height ?? null
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
    ...(q.width !== undefined ? { width: q.width } : {}),
    ...(q.height !== undefined ? { height: q.height } : {}),
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
app.get("/v1/meta.json", (req, reply) => handleMetaJson(req, reply));

// legacy (unversioned) endpoints, kept for compatibility
app.get("/render.svg", (req, reply) => handleRenderSvg(req, reply, { deprecated: true }));
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

