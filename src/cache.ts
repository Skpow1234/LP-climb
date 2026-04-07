import { LRUCache } from "lru-cache";

export type CacheKey = string;

export type Cache = {
  get: (key: CacheKey) => string | undefined;
  set: (key: CacheKey, value: string, ttlSeconds: number) => void;
};

export function createMemoryCache(params: { maxEntries: number }): Cache {
  const lru = new LRUCache<string, { value: string; exp: number }>({
    max: params.maxEntries
  });

  return {
    get: (key) => {
      const v = lru.get(key);
      if (!v) return undefined;
      if (Date.now() > v.exp) {
        lru.delete(key);
        return undefined;
      }
      return v.value;
    },
    set: (key, value, ttlSeconds) => {
      lru.set(key, { value, exp: Date.now() + ttlSeconds * 1000 });
    }
  };
}

