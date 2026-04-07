import { LRUCache } from "lru-cache";

export type CacheKey = string;

export type CacheGetResult =
  | { hit: false }
  | { hit: true; stale: false; value: string; storedAtMs: number }
  | { hit: true; stale: true; value: string; storedAtMs: number };

export type Cache = {
  get: (key: CacheKey) => CacheGetResult;
  set: (key: CacheKey, value: string, ttlSeconds: number, staleSeconds: number) => void;
};

export function createMemoryCache(params: { maxEntries: number }): Cache {
  const lru = new LRUCache<
    string,
    { value: string; freshUntil: number; staleUntil: number; storedAtMs: number }
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

