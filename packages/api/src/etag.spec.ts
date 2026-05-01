import { describe, expect, it } from "vitest";
import { buildDeterministicEtag, ifNoneMatchMatches } from "./etag.js";

describe("buildDeterministicEtag", () => {
  it("is stable for identical keys", () => {
    expect(buildDeterministicEtag("same-key")).toBe(buildDeterministicEtag("same-key"));
  });

  it("changes when the key changes", () => {
    expect(buildDeterministicEtag("a")).not.toBe(buildDeterministicEtag("b"));
  });
});

describe("ifNoneMatchMatches", () => {
  const etag = buildDeterministicEtag("resource-key");

  it("matches an exact strong etag", () => {
    expect(ifNoneMatchMatches(etag, etag)).toBe(true);
  });

  it("matches strong and weak variants interchangeably for GET semantics", () => {
    expect(ifNoneMatchMatches(`W/${etag}`, etag)).toBe(true);
    expect(ifNoneMatchMatches(etag, `W/${etag}`)).toBe(true);
  });

  it("matches within a comma-separated candidate list", () => {
    expect(ifNoneMatchMatches(`"other", ${etag}, "third"`, etag)).toBe(true);
  });

  it("matches the wildcard form", () => {
    expect(ifNoneMatchMatches("*", etag)).toBe(true);
  });

  it("returns false when there is no match", () => {
    expect(ifNoneMatchMatches('"different"', etag)).toBe(false);
  });
});
