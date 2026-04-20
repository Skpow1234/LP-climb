import { LRUCache } from "lru-cache";

export type CacheKey = string;

export type CacheGetResult<V> =
  | { hit: false }
  | { hit: true; stale: false; value: V; storedAtMs: number }
  | { hit: true; stale: true; value: V; storedAtMs: number };

export type Cache<V> = {
  get: (key: CacheKey) => CacheGetResult<V>;
  set: (key: CacheKey, value: V, ttlSeconds: number, staleSeconds: number) => void;
};

/**
 * Stale-While-Revalidate LRU.
 *
 * - `freshUntil`: while `now <= freshUntil`, the entry is returned as a hit.
 * - `staleUntil`: while `freshUntil < now <= staleUntil`, the entry is
 *   returned as `stale: true` (callers typically serve it immediately and
 *   refresh in the background).
 * - After `staleUntil`, the entry is evicted on read and reported as a miss.
 *
 * The value type `V` is generic so callers can store strings (SVG / JSON /
 * Prometheus text) or raw `Buffer`s (PNG / WebP / AVIF / GIF) without an
 * extra base64 round-trip. `lru-cache` accepts any value — we just keep the
 * public type surface honest.
 */
export function createMemoryCache<V>(params: { maxEntries: number }): Cache<V> {
  const lru = new LRUCache<
    string,
    { value: V; freshUntil: number; staleUntil: number; storedAtMs: number }
  >({
    max: params.maxEntries
  });

  return {
    get: (key) => {
      const v = lru.get(key);
      if (!v) return { hit: false };
      const now = Date.now();
      if (now > v.staleUntil) {
        lru.delete(key);
        return { hit: false };
      }
      if (now <= v.freshUntil) {
        return { hit: true, stale: false, value: v.value, storedAtMs: v.storedAtMs };
      }
      return { hit: true, stale: true, value: v.value, storedAtMs: v.storedAtMs };
    },
    set: (key, value, ttlSeconds, staleSeconds) => {
      const now = Date.now();
      lru.set(key, {
        value,
        storedAtMs: now,
        freshUntil: now + ttlSeconds * 1000,
        staleUntil: now + (ttlSeconds + Math.max(0, staleSeconds)) * 1000
      });
    }
  };
}

/**
 * Deduplicate concurrent async calls by key.
 *
 * On a cache miss, multiple in-flight requests for the same user can each
 * kick off their own upstream fetch — creating a "cache stampede" that
 * multiplies GitHub GraphQL traffic (and costs) for what should be one call.
 *
 * `Coalescer` wraps a (key -> Promise) factory so that the first caller for
 * a given key runs the factory and all subsequent callers receive the same
 * in-flight promise until it settles. On settlement the key is released so
 * the next cold request can do real work.
 *
 * Usage:
 *     const coalesce = createCoalescer<string, MyValue>();
 *     const value = await coalesce("octocat", () => fetchAndCache("octocat"));
 */
export type Coalescer<K, V> = (key: K, run: () => Promise<V>) => Promise<V>;

export function createCoalescer<K, V>(): Coalescer<K, V> {
  const inflight = new Map<K, Promise<V>>();
  return (key, run) => {
    const existing = inflight.get(key);
    if (existing) return existing;
    const p = run().finally(() => {
      inflight.delete(key);
    });
    inflight.set(key, p);
    return p;
  };
}
