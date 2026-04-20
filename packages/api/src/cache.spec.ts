import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCoalescer, createMemoryCache } from "./cache.js";

describe("createMemoryCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns miss for an unset key", () => {
    const c = createMemoryCache<string>({ maxEntries: 4 });
    expect(c.get("nope")).toEqual({ hit: false });
  });

  it("returns a fresh hit within the TTL window", () => {
    const c = createMemoryCache<string>({ maxEntries: 4 });
    c.set("k", "v", 10, 30);
    const hit = c.get("k");
    expect(hit).toMatchObject({ hit: true, stale: false, value: "v" });
  });

  it("transitions fresh → stale after TTL elapses", () => {
    const c = createMemoryCache<string>({ maxEntries: 4 });
    c.set("k", "v", 10, 30);
    vi.advanceTimersByTime(11_000);
    const hit = c.get("k");
    expect(hit).toMatchObject({ hit: true, stale: true, value: "v" });
  });

  it("evicts once past (ttl + stale) window, reporting miss thereafter", () => {
    const c = createMemoryCache<string>({ maxEntries: 4 });
    c.set("k", "v", 10, 30);
    vi.advanceTimersByTime(41_000);
    expect(c.get("k")).toEqual({ hit: false });
    // Second read stays a miss — the first read deleted the entry.
    expect(c.get("k")).toEqual({ hit: false });
  });

  it("holds Buffers without mangling them (binary path)", () => {
    const c = createMemoryCache<Buffer>({ maxEntries: 4 });
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    c.set("png", buf, 10, 30);
    const hit = c.get("png");
    expect(hit.hit).toBe(true);
    if (hit.hit) {
      expect(Buffer.compare(hit.value, buf)).toBe(0);
    }
  });

  it("LRU-evicts the oldest entry once `maxEntries` is exceeded", () => {
    const c = createMemoryCache<string>({ maxEntries: 2 });
    c.set("a", "A", 60, 60);
    c.set("b", "B", 60, 60);
    c.set("c", "C", 60, 60);
    expect(c.get("a")).toEqual({ hit: false });
    expect(c.get("b").hit).toBe(true);
    expect(c.get("c").hit).toBe(true);
  });

  it("treats staleSeconds=0 as 'no grace period' (immediate eviction after TTL)", () => {
    const c = createMemoryCache<string>({ maxEntries: 4 });
    c.set("k", "v", 5, 0);
    vi.advanceTimersByTime(5_001);
    expect(c.get("k")).toEqual({ hit: false });
  });
});

describe("createCoalescer", () => {
  it("deduplicates concurrent calls for the same key to a single factory run", async () => {
    const coalesce = createCoalescer<string, number>();
    let calls = 0;
    let release!: (v: number) => void;
    const pending = new Promise<number>((resolve) => {
      release = resolve;
    });

    const factory = () => {
      calls++;
      return pending;
    };

    const a = coalesce("k", factory);
    const b = coalesce("k", factory);
    const c = coalesce("k", factory);

    release(42);
    await expect(Promise.all([a, b, c])).resolves.toEqual([42, 42, 42]);
    expect(calls).toBe(1);
  });

  it("releases the inflight slot on settle so the next cold call re-runs", async () => {
    const coalesce = createCoalescer<string, number>();
    let calls = 0;
    const factory = async () => ++calls;

    await coalesce("k", factory);
    await coalesce("k", factory);
    expect(calls).toBe(2);
  });

  it("releases the inflight slot on rejection", async () => {
    const coalesce = createCoalescer<string, number>();
    let attempt = 0;
    const factory = async () => {
      attempt++;
      if (attempt === 1) throw new Error("boom");
      return 7;
    };

    await expect(coalesce("k", factory)).rejects.toThrow("boom");
    await expect(coalesce("k", factory)).resolves.toBe(7);
  });

  it("treats different keys as independent slots (no cross-talk)", async () => {
    const coalesce = createCoalescer<string, string>();
    const [a, b] = await Promise.all([
      coalesce("a", async () => "A"),
      coalesce("b", async () => "B")
    ]);
    expect([a, b]).toEqual(["A", "B"]);
  });
});
