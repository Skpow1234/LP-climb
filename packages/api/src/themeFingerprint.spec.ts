import { describe, expect, it } from "vitest";
import { themeFingerprint } from "./themeFingerprint.js";

// Shape-compatible with `@lp-climb/themes` — we don't import the actual
// package here to keep this unit test isolated.
const baseTheme = {
  id: "rift",
  name: "Rift",
  bg: "#0b0a14",
  frame: "#1a1830",
  text: "#e7e6f1",
  accent: "#ff9d3c",
  glow: "#ff5733",
  tier: {
    iron: "#735a3f",
    bronze: "#c17a4b",
    silver: "#b6c2cc",
    gold: "#e6b34d",
    plat: "#8fe3d3",
    emerald: "#3eb489",
    diamond: "#a0d8f1",
    master: "#c77df0",
    grandmaster: "#ff5c5c",
    challenger: "#ffd36b"
  }
};

describe("themeFingerprint (cache-key regression)", () => {
  it("returns the same string for identical theme objects", () => {
    expect(themeFingerprint(baseTheme)).toBe(themeFingerprint(structuredClone(baseTheme)));
  });

  it("ignores `name` (display-only)", () => {
    const renamed = { ...baseTheme, name: "Completely Different Name" };
    expect(themeFingerprint(renamed)).toBe(themeFingerprint(baseTheme));
  });

  it("changes when `accent` is overridden — the champion-select bug regression", () => {
    const overridden = { ...baseTheme, accent: "#ff0000" };
    expect(themeFingerprint(overridden)).not.toBe(themeFingerprint(baseTheme));
  });

  it("changes when any of bg/frame/text/glow is overridden", () => {
    for (const field of ["bg", "frame", "text", "glow"] as const) {
      const overridden = { ...baseTheme, [field]: "#deadbe" };
      expect(themeFingerprint(overridden)).not.toBe(themeFingerprint(baseTheme));
    }
  });

  it("changes when a tier color is overridden", () => {
    const overridden = {
      ...baseTheme,
      tier: { ...baseTheme.tier, challenger: "#ff00ff" }
    };
    expect(themeFingerprint(overridden)).not.toBe(themeFingerprint(baseTheme));
  });

  it("changes when `id` changes (different base theme)", () => {
    const assassin = { ...baseTheme, id: "assassin" };
    expect(themeFingerprint(assassin)).not.toBe(themeFingerprint(baseTheme));
  });
});
