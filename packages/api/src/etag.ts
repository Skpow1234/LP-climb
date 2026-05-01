import { createHash } from "node:crypto";

export function buildDeterministicEtag(key: string): string {
  return `"${createHash("sha1").update(key).digest("base64")}"`;
}

function stripWeakPrefix(tag: string): string {
  return tag.startsWith("W/") ? tag.slice(2) : tag;
}

export function ifNoneMatchMatches(headerValue: string | string[] | undefined, etag: string): boolean {
  if (!headerValue) return false;
  const raw = Array.isArray(headerValue) ? headerValue.join(",") : headerValue;
  const candidates = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (candidates.includes("*")) return true;

  const normalized = stripWeakPrefix(etag);
  return candidates.some((candidate) => stripWeakPrefix(candidate) === normalized);
}
