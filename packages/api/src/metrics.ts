// Prometheus metrics surface for the LP Climb API. Kept deliberately tiny:
//   - default Node/process metrics (event loop lag, heap, GC, etc.)
//   - per-route HTTP counter + duration histogram
//   - LP Climb-specific counters for the SWR cache and GitHub upstream
//
// Exposed at `GET /metrics` and `GET /v1/metrics` from server.ts.
//
// Labels are deliberately low-cardinality: we use the Fastify `routeUrl`
// (e.g. `/v1/render.svg`, not the full URL with query params) to avoid
// cardinality explosions from user-supplied values.

import { collectDefaultMetrics, Counter, Histogram, Registry } from "prom-client";

export const registry = new Registry();
registry.setDefaultLabels({ service: "lp-climb-api" });
collectDefaultMetrics({ register: registry });

export const httpRequestsTotal = new Counter({
  name: "http_requests_total",
  help: "Total HTTP requests handled by the API.",
  labelNames: ["method", "route", "status"] as const,
  registers: [registry]
});

export const httpRequestDurationSeconds = new Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds.",
  labelNames: ["method", "route", "status"] as const,
  // Buckets chosen to cover typical SVG cache hits (<5ms) through PNG/AVIF
  // encodes and the worst-case GIF frame loop (~1-2s on small dimensions).
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry]
});

export const cacheEventsTotal = new Counter({
  name: "lp_climb_cache_events_total",
  help: "SWR LRU cache events, grouped by kind (contrib vs. render) and source.",
  labelNames: ["kind", "source"] as const,
  registers: [registry]
});

export const githubFetchTotal = new Counter({
  name: "lp_climb_github_fetch_total",
  help: "Outbound GitHub GraphQL fetches, grouped by result.",
  labelNames: ["result"] as const,
  registers: [registry]
});

export function recordCacheEvent(kind: "contrib" | "render", source: "hit" | "stale" | "miss") {
  cacheEventsTotal.labels(kind, source).inc();
}

export function recordGithubFetch(result: "success" | "error") {
  githubFetchTotal.labels(result).inc();
}

/**
 * Render the registry as Prometheus text exposition format. Returns
 * `{ body, contentType }` so the HTTP handler can set the correct header.
 */
export async function renderMetrics(): Promise<{ body: string; contentType: string }> {
  return {
    body: await registry.metrics(),
    contentType: registry.contentType
  };
}
