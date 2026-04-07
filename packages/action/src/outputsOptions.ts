import { getTheme } from "@lp-climb/themes";

export type OutputEntry = {
  filename: string;
  theme: ReturnType<typeof getTheme>;
  width?: number;
  height?: number;
  vs?: string;
};

export const parseOutputsOption = (lines: string[]) => lines.map(parseEntry).filter(Boolean) as OutputEntry[];

export const parseEntry = (entry: string): OutputEntry | null => {
  const m = entry.trim().match(/^(.+\.svg)(\?(.*)|\s*({.*}))?$/);
  if (!m) return null;

  const filename = m[1]!;
  const q1 = m[3];
  const q2 = m[4];
  const query = q1 ?? q2 ?? "";

  let sp = new URLSearchParams(query);
  try {
    const o = JSON.parse(query);
    sp = new URLSearchParams(o);
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err;
  }

  const theme = getTheme(sp.get("theme"));
  const width = sp.has("width") ? Number(sp.get("width")) : undefined;
  const height = sp.has("height") ? Number(sp.get("height")) : undefined;
  const vs = sp.get("vs") || undefined;

  const clampInt = (n: number, min: number, max: number) =>
    Number.isFinite(n) ? Math.max(min, Math.min(max, Math.trunc(n))) : undefined;

  const w = width !== undefined ? clampInt(width, 500, 2000) : undefined;
  const h = height !== undefined ? clampInt(height, 180, 900) : undefined;

  return {
    filename,
    theme,
    ...(w !== undefined ? { width: w } : {}),
    ...(h !== undefined ? { height: h } : {}),
    ...(vs ? { vs } : {})
  };
};

