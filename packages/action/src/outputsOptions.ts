import { getTheme } from "@lp-climb/themes";

/**
 * Supported output formats. Keep this list aligned with the renderer exports
 * in `@lp-climb/svg-creator` and the API's /v1/render.* routes.
 */
export const SUPPORTED_EXTENSIONS = ["svg", "png", "webp", "avif", "gif"] as const;
export type OutputFormat = (typeof SUPPORTED_EXTENSIONS)[number];

export type OutputEntry = {
  filename: string;
  format: OutputFormat;
  theme: ReturnType<typeof getTheme>;
  width?: number;
  height?: number;
  style?: "card" | "ladder";
  vs?: string;
  team?: string[];
  quality?: number;
  frames?: number;
  fps?: number;
};

const EXT_RE = new RegExp(
  `^(.+\\.(${SUPPORTED_EXTENSIONS.join("|")}))(\\?(.*)|\\s*(\\{.*\\}))?$`,
  "i"
);

const CSS_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const TIER_KEYS = [
  "iron",
  "bronze",
  "silver",
  "gold",
  "plat",
  "emerald",
  "diamond",
  "master",
  "grandmaster",
  "challenger"
] as const;

const clampInt = (n: number, min: number, max: number) =>
  Number.isFinite(n) ? Math.max(min, Math.min(max, Math.trunc(n))) : undefined;

const asColor = (v: string | null | undefined): string | undefined => {
  if (!v) return undefined;
  const trimmed = v.trim();
  return CSS_COLOR.test(trimmed) ? trimmed : undefined;
};

/**
 * Applies per-output color overrides on top of the base theme picked by
 * `theme=…`. Mirrors the API's `applyThemeOverrides` so a
 * `dist/card.svg?theme=rift&accent=%23ff2d55` in the Action produces the
 * same pixels as the matching API request.
 */
const applyThemeOverrides = (base: ReturnType<typeof getTheme>, sp: URLSearchParams) => {
  const out = structuredClone(base) as any;
  for (const k of ["bg", "frame", "text", "accent", "glow"] as const) {
    const color = asColor(sp.get(k));
    if (color) out[k] = color;
  }
  for (const k of TIER_KEYS) {
    const color = asColor(sp.get(`tier_${k}`));
    if (color) out.tier[k] = color;
  }
  return out as ReturnType<typeof getTheme>;
};

export const parseOutputsOption = (lines: string[]) =>
  lines.map(parseEntry).filter(Boolean) as OutputEntry[];

export const parseEntry = (entry: string): OutputEntry | null => {
  const m = entry.trim().match(EXT_RE);
  if (!m) return null;

  const filename = m[1]!;
  const ext = m[2]!.toLowerCase() as OutputFormat;
  const q1 = m[4];
  const q2 = m[5];
  const query = q1 ?? q2 ?? "";

  let sp = new URLSearchParams(query);
  try {
    const parsed = JSON.parse(query);
    sp = new URLSearchParams(parsed);
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err;
  }

  const theme = applyThemeOverrides(getTheme(sp.get("theme")), sp);

  const width = sp.has("width") ? clampInt(Number(sp.get("width")), 500, 2000) : undefined;
  const height = sp.has("height") ? clampInt(Number(sp.get("height")), 180, 900) : undefined;

  const rawStyle = sp.get("style");
  const style: "card" | "ladder" | undefined =
    rawStyle === "card" || rawStyle === "ladder" ? rawStyle : undefined;

  const vs = sp.get("vs") || undefined;
  const teamRaw = sp.get("team") || undefined;
  const team = teamRaw
    ? teamRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 5)
    : undefined;

  const quality = sp.has("quality") ? clampInt(Number(sp.get("quality")), 0, 100) : undefined;
  const frames = sp.has("frames") ? clampInt(Number(sp.get("frames")), 6, 60) : undefined;
  const fps = sp.has("fps") ? clampInt(Number(sp.get("fps")), 4, 30) : undefined;

  return {
    filename,
    format: ext,
    theme,
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(style ? { style } : {}),
    ...(vs ? { vs } : {}),
    ...(team && team.length > 0 ? { team } : {}),
    ...(quality !== undefined ? { quality } : {}),
    ...(frames !== undefined ? { frames } : {}),
    ...(fps !== undefined ? { fps } : {})
  };
};
