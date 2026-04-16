// Named dimension presets for common embedding use-cases. Explicit `width` /
// `height` query parameters always take precedence over a preset's values, so
// callers can pick a named size and then nudge a single axis.
//
// Values MUST stay within the render schema's bounds (width 500..2000,
// height 180..900) or the Zod validator will reject the resolved query.

export type PresetId =
  | "readme"
  | "readme-wide"
  | "readme-compact"
  | "profile"
  | "banner"
  | "badge";

export type Preset = {
  id: PresetId;
  label: string;
  width: number;
  height: number;
  description: string;
};

export const PRESETS: Record<PresetId, Preset> = {
  readme: {
    id: "readme",
    label: "README",
    width: 900,
    height: 260,
    description: "Standard GitHub README embed (matches the SVG renderer default)."
  },
  "readme-wide": {
    id: "readme-wide",
    label: "README (wide)",
    width: 1100,
    height: 280,
    description: "Wider README embed for repos that use a centered layout."
  },
  "readme-compact": {
    id: "readme-compact",
    label: "README (compact)",
    width: 720,
    height: 200,
    description: "Compact embed for small-profile README sections."
  },
  profile: {
    id: "profile",
    label: "Profile card",
    width: 600,
    height: 240,
    description: "Good fit for GitHub profile README cards."
  },
  banner: {
    id: "banner",
    label: "Banner",
    width: 1200,
    height: 300,
    description: "Wide banner; use for headers of profile READMEs or sites."
  },
  badge: {
    id: "badge",
    label: "Badge",
    width: 500,
    height: 180,
    description: "Smallest allowed size; approximates a shields.io-style badge row."
  }
};

export const PRESET_IDS = Object.keys(PRESETS) as PresetId[];

export function listPresets(): Preset[] {
  return PRESET_IDS.map((id) => PRESETS[id]);
}

/**
 * Resolve a preset id + optional explicit width/height into concrete pixel
 * dimensions. Explicit values win over preset values. Returns `{}` when no
 * preset and no explicit dims were supplied (so the renderer uses its own
 * internal defaults).
 */
export function resolveDims(q: {
  preset?: PresetId | string | undefined;
  width?: number | undefined;
  height?: number | undefined;
}): { width?: number; height?: number } {
  const preset: Preset | undefined = q.preset
    ? (PRESETS as Record<string, Preset | undefined>)[q.preset]
    : undefined;
  const width = q.width ?? preset?.width;
  const height = q.height ?? preset?.height;
  const out: { width?: number; height?: number } = {};
  if (width !== undefined) out.width = width;
  if (height !== undefined) out.height = height;
  return out;
}
