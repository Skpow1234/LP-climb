import { describe, expect, it } from "vitest";
import { computeDeterministicJitterMs } from "./refreshJitter.js";

describe("computeDeterministicJitterMs", () => {
  it("returns a stable value for the same key and instance", () => {
    const a = computeDeterministicJitterMs("cache-key", "instance-a", 2500);
    const b = computeDeterministicJitterMs("cache-key", "instance-a", 2500);
    expect(a).toBe(b);
  });

  it("stays within the configured bounds", () => {
    const jitter = computeDeterministicJitterMs("cache-key", "instance-a", 2500);
    expect(jitter).toBeGreaterThanOrEqual(0);
    expect(jitter).toBeLessThan(2500);
  });

  it("varies across different instances or keys", () => {
    const a = computeDeterministicJitterMs("cache-key", "instance-a", 2500);
    const b = computeDeterministicJitterMs("cache-key", "instance-b", 2500);
    const c = computeDeterministicJitterMs("other-key", "instance-a", 2500);
    expect(new Set([a, b, c]).size).toBeGreaterThan(1);
  });

  it("returns zero when jitter is disabled", () => {
    expect(computeDeterministicJitterMs("cache-key", "instance-a", 0)).toBe(0);
  });
});
