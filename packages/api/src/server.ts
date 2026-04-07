import Fastify from "fastify";
import sensible from "@fastify/sensible";
import etag from "@fastify/etag";
import rateLimit from "@fastify/rate-limit";
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
  trustProxy: true
});

await app.register(sensible);
await app.register(etag);
await app.register(rateLimit, {
  max: env.RATE_LIMIT_MAX,
  timeWindow: env.RATE_LIMIT_TIME_WINDOW_SECONDS * 1000
});

app.get("/healthz", async () => ({ ok: true }));

const RenderQuerySchema = z.object({
  user: z.string().min(1).max(39),
  theme: z.string().optional(),
  width: z.coerce.number().int().min(500).max(2000).optional(),
  height: z.coerce.number().int().min(180).max(900).optional(),
  vs: z.string().min(1).max(39).optional()
});

app.get("/render.svg", async (req, reply) => {
  const q = RenderQuerySchema.parse(req.query);
  const theme = getTheme(q.theme ?? null);

  const cacheKey = JSON.stringify({
    v: 1,
    route: "render.svg",
    user: q.user,
    vs: q.vs ?? null,
    theme: theme.id,
    width: q.width ?? null,
    height: q.height ?? null
  });

  const cached = cache.get(cacheKey);
  if (cached) {
    reply.header("Content-Type", "image/svg+xml; charset=utf-8");
    reply.header("Cache-Control", `public, max-age=${env.CACHE_TTL_SECONDS}`);
    return cached;
  }

  const [cellsA, cellsB] = await Promise.all([
    fetchGithubContributionCells({ user: q.user, githubToken: env.GITHUB_TOKEN }),
    q.vs
      ? fetchGithubContributionCells({ user: q.vs, githubToken: env.GITHUB_TOKEN })
      : Promise.resolve(null)
  ]);

  const statsA = computeStats(cellsA);
  const statsB = cellsB ? computeStats(cellsB) : null;

  const svg = renderRankedClimbSvg({
    user: q.user,
    cells: cellsA,
    stats: statsA,
    theme,
    ...(q.width !== undefined ? { width: q.width } : {}),
    ...(q.height !== undefined ? { height: q.height } : {}),
    ...(q.vs && cellsB && statsB ? { vs: { user: q.vs, cells: cellsB, stats: statsB } } : {})
  });

  cache.set(cacheKey, svg, env.CACHE_TTL_SECONDS);

  reply.header("Content-Type", "image/svg+xml; charset=utf-8");
  reply.header("Cache-Control", `public, max-age=${env.CACHE_TTL_SECONDS}`);
  return svg;
});

app.get("/meta.json", async (req, reply) => {
  const q = RenderQuerySchema.pick({ user: true, vs: true }).parse(req.query);
  const cacheKey = JSON.stringify({ v: 1, route: "meta.json", user: q.user, vs: q.vs ?? null });
  const cached = cache.get(cacheKey);
  if (cached) {
    reply.header("Content-Type", "application/json; charset=utf-8");
    reply.header("Cache-Control", `public, max-age=${env.CACHE_TTL_SECONDS}`);
    return cached;
  }

  const [cellsA, cellsB] = await Promise.all([
    fetchGithubContributionCells({ user: q.user, githubToken: env.GITHUB_TOKEN }),
    q.vs
      ? fetchGithubContributionCells({ user: q.vs, githubToken: env.GITHUB_TOKEN })
      : Promise.resolve(null)
  ]);

  const body = JSON.stringify({
    user: q.user,
    stats: computeStats(cellsA),
    vs: q.vs && cellsB ? { user: q.vs, stats: computeStats(cellsB) } : null
  });

  cache.set(cacheKey, body, env.CACHE_TTL_SECONDS);
  reply.header("Content-Type", "application/json; charset=utf-8");
  reply.header("Cache-Control", `public, max-age=${env.CACHE_TTL_SECONDS}`);
  return body;
});

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

