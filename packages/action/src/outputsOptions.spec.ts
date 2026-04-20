import { describe, expect, it } from "vitest";
import { parseEntry, parseOutputsOption, SUPPORTED_EXTENSIONS } from "./outputsOptions.js";

describe("parseEntry", () => {
  it("returns null for unsupported extensions", () => {
    expect(parseEntry("dist/lp.jpg?theme=rift")).toBeNull();
    expect(parseEntry("dist/lp.html")).toBeNull();
    expect(parseEntry("not-a-file-path")).toBeNull();
  });

  it("accepts every supported extension", () => {
    for (const ext of SUPPORTED_EXTENSIONS) {
      const r = parseEntry(`dist/lp.${ext}?theme=rift`);
      expect(r?.format).toBe(ext);
    }
  });

  it("parses width/height as clamped ints", () => {
    const r = parseEntry("dist/lp.svg?theme=rift&width=99999&height=20");
    expect(r?.width).toBe(2000); // clamped to upper bound
    expect(r?.height).toBe(180); // clamped to lower bound
  });

  it("silently drops non-numeric dims (would have cast to NaN otherwise)", () => {
    const r = parseEntry("dist/lp.svg?theme=rift&width=huge");
    expect(r?.width).toBeUndefined();
  });

  it("parses style only when it's one of card|ladder", () => {
    expect(parseEntry("dist/lp.svg?style=card")?.style).toBe("card");
    expect(parseEntry("dist/lp.svg?style=ladder")?.style).toBe("ladder");
    expect(parseEntry("dist/lp.svg?style=wheel")?.style).toBeUndefined();
  });

  it("parses team into a trimmed, de-duped-ish list capped at 5", () => {
    const r = parseEntry("dist/lp.svg?style=ladder&team=a,b, c , , d,e,f,g");
    expect(r?.team).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("accepts vs as a single login", () => {
    expect(parseEntry("dist/lp.svg?style=ladder&vs=torvalds")?.vs).toBe("torvalds");
  });

  it("parses clamped encoder tuning: quality (0..100), frames (6..60), fps (4..30)", () => {
    const r = parseEntry("dist/lp.gif?style=ladder&frames=2&fps=99&quality=150");
    expect(r?.frames).toBe(6); // clamped to min
    expect(r?.fps).toBe(30); // clamped to max
    expect(r?.quality).toBe(100); // clamped to max
  });

  it("applies color overrides to the theme (base colors + tiers)", () => {
    const r = parseEntry(
      "dist/lp.svg?theme=rift&accent=%23ff2d55&bg=%23000000&tier_challenger=%23abcdef"
    );
    expect((r!.theme as any).accent).toBe("#ff2d55");
    expect((r!.theme as any).bg).toBe("#000000");
    expect((r!.theme as any).tier.challenger).toBe("#abcdef");
  });

  it("rejects invalid colors without crashing", () => {
    const r = parseEntry("dist/lp.svg?theme=rift&accent=rocket");
    // Invalid color is silently ignored; theme falls back to its default accent.
    expect((r!.theme as any).accent).not.toBe("rocket");
  });

  it("accepts a JSON blob query-string shape as well as a URL-encoded one", () => {
    const r = parseEntry('dist/lp.svg{"theme":"rift","width":"900","height":"260"}');
    expect(r?.width).toBe(900);
    expect(r?.height).toBe(260);
  });

  it("extension match is case-insensitive on file type", () => {
    const r = parseEntry("dist/lp.SVG?theme=rift");
    expect(r?.format).toBe("svg");
  });
});

describe("parseOutputsOption", () => {
  it("skips unparseable lines and returns only valid entries", () => {
    const out = parseOutputsOption([
      "dist/lp.svg?theme=rift",
      "garbage line",
      "dist/lp.png?theme=assassin"
    ]);
    expect(out.map((e) => e.format)).toEqual(["svg", "png"]);
  });

  it("preserves input order", () => {
    const out = parseOutputsOption(["dist/a.svg?theme=rift", "dist/b.png?theme=assassin"]);
    expect(out.map((e) => e.filename)).toEqual(["dist/a.svg", "dist/b.png"]);
  });
});
