import { createHash } from "node:crypto";

export function computeDeterministicJitterMs(
  key: string,
  instanceId: string,
  maxJitterMs: number
): number {
  if (!Number.isFinite(maxJitterMs) || maxJitterMs <= 0) return 0;
  const digest = createHash("sha1").update(instanceId).update("\0").update(key).digest();
  const bucket = digest.readUInt32BE(0);
  return bucket % Math.max(1, Math.trunc(maxJitterMs));
}

export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
