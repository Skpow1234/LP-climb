import type { ContributionCell, ContributionStats, Theme } from "@lp-climb/types";
import { computeLpTimeline, TIERS } from "@lp-climb/core";
import { Resvg } from "@resvg/resvg-js";
// `gifenc` ships as CommonJS (no `exports` ESM condition) so Node's native
// ESM loader cannot reliably extract named bindings at runtime. We import the
// default (CJS `module.exports`) object and destructure it at module scope.
import gifenc from "gifenc";
import sharp from "sharp";
import { renderProfileCardSvg } from "./card.js";

export { renderProfileCardSvg } from "./card.js";

const { GIFEncoder, quantize, applyPalette } = gifenc;

export type TeamMember = {
  user: string;
  cells: ContributionCell[];
  stats: ContributionStats;
};

/**
 * Which visualization to render.
 *
 * - `"card"` (default): GitHub-style profile tier card. Hex badge + 5 metric
 *   bars. Renders the primary user only (ignores `vs` / `team`).
 * - `"ladder"`: original horizontal ladder climb. Supports `vs` and `team`
 *   modes. Kept for backwards compatibility and snapshot-test stability.
 */
export type RenderStyle = "card" | "ladder";

export type RenderParams = {
  user: string;
  cells: ContributionCell[];
  stats: ContributionStats;
  theme: Theme;
  width?: number;
  height?: number;
  vs?: TeamMember;
  /**
   * Optional team members rendered alongside the primary user on the same
   * ladder. When provided (non-empty), mutually exclusive with `vs` — the API
   * layer rejects the combined request. Each member gets a distinctly-colored
   * marker and a compact LP badge. Order is stable (insertion order).
   */
  team?: TeamMember[];
  /**
   * When set to a number in [0, 1], the SVG is rendered as a still frame
   * (no CSS animation) with markers positioned at the corresponding point
   * on the LP timeline. Used by the GIF encoder to rasterize individual frames.
   * When undefined (default), the SVG contains CSS keyframe animations and
   * the output is byte-identical to previous snapshot tests.
   */
  staticProgress?: number;
  /**
   * Visualization style. Defaults to `"card"`. Use `"ladder"` for the legacy
   * horizontal climb ladder (and for snapshot tests that pre-date the card
   * UI).
   */
  style?: RenderStyle;
};

/**
 * Distinct, accessible marker fill colors for team members. The primary user
 * keeps the theme's `accent`; `vs` keeps its near-white fill. The first team
 * member picks index 0 here, the second index 1, and so on (cycling).
 */
const TEAM_MARKER_COLORS = [
  "#7dd3fc", // sky-300
  "#f472b6", // pink-400
  "#a78bfa", // violet-400
  "#fbbf24", // amber-400
  "#34d399", // emerald-400
  "#fb7185"  // rose-400
];

export type RenderGifOptions = {
  /** Number of frames to sample (clamped 6..60). */
  frames?: number;
  /** Frames per second for GIF playback (clamped 4..30). */
  fps?: number;
};

export type RenderRasterOptions = {
  /** Encoder quality (0..100). Defaults: webp=82, avif=55. */
  quality?: number;
};

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function esc(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function lpToY(lp: number, top: number, bottom: number) {
  const min = TIERS[0]!.lpMin;
  const max = TIERS.at(-1)!.lpMax;
  const t = (lp - min) / (max - min);
  return bottom - t * (bottom - top);
}

function roundPx(n: number) {
  // Snapshot tests compare raw SVG text. Rounding avoids tiny float drift
  // across V8 patch versions / platforms while remaining visually identical.
  return Math.round(n * 1000) / 1000;
}

function formatWeekday(weekday: number) {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][weekday] ?? String(weekday);
}

/**
 * Top-level dispatcher. Picks the renderer based on `p.style`. Default is
 * `"card"`. The ladder path preserves its original output byte-for-byte so
 * existing snapshot tests (which now pass `style: "ladder"` explicitly) keep
 * matching.
 */
export function renderRankedClimbSvg(p: RenderParams): string {
  const style: RenderStyle = p.style ?? "card";
  if (style === "ladder") return renderLadderSvg(p);
  return renderProfileCardSvg(p);
}

export function renderLadderSvg(p: RenderParams): string {
  const W = p.width ?? 900;
  const H = p.height ?? 260;

  const padding = 18;
  const headerH = 58;
  const footerH = 46;

  const ladderX0 = padding + 210;
  const ladderX1 = W - padding - 18;
  const ladderTop = padding + headerH;
  const ladderBottom = H - padding - footerH;

  const t0 = computeLpTimeline(p.cells);
  const t1 = p.vs ? computeLpTimeline(p.vs.cells) : null;

  // Team members are only rendered when `vs` is not set. API enforces this;
  // the renderer defensively ignores `team` when `vs` is set so output for
  // vs-mode stays byte-identical to the existing snapshot tests.
  const teamMembers = !p.vs && p.team && p.team.length > 0 ? p.team : [];
  const teamTimelines = teamMembers.map((m) => computeLpTimeline(m.cells));

  const head = t0.at(-1);
  const head2 = t1?.at(-1);

  const keyframes = (() => {
    if (t0.length === 0) return "";
    const n = t0.length;
    const pts = t0.map((d, i) => {
      const k = Math.round((i / Math.max(1, n - 1)) * 1000) / 10;
      const y = lpToY(d.lp, ladderTop, ladderBottom);
      return `${k}% { transform: translate(0px, ${roundPx(y - ladderTop)}px); }`;
    });
    return pts.join("\n");
  })();

  const keyframes2 = (() => {
    if (!t1 || t1.length === 0) return "";
    const n = t1.length;
    const pts = t1.map((d, i) => {
      const k = Math.round((i / Math.max(1, n - 1)) * 1000) / 10;
      const y = lpToY(d.lp, ladderTop, ladderBottom);
      return `${k}% { transform: translate(0px, ${roundPx(y - ladderTop)}px); }`;
    });
    return pts.join("\n");
  })();

  const teamKeyframes = teamTimelines
    .map((tl, idx) => {
      if (tl.length === 0) return "";
      const n = tl.length;
      const name = `climbT${idx}`;
      const pts = tl
        .map((d, i) => {
          const k = Math.round((i / Math.max(1, n - 1)) * 1000) / 10;
          const y = lpToY(d.lp, ladderTop, ladderBottom);
          return `${k}% { transform: translate(0px, ${roundPx(y - ladderTop)}px); }`;
        })
        .join("\n");
      return `@keyframes ${name} { ${pts} }`;
    })
    .filter(Boolean)
    .join("\n");

  const teamCss = teamMembers
    .map((_, idx) => {
      const color = TEAM_MARKER_COLORS[idx % TEAM_MARKER_COLORS.length]!;
      return `.markerT${idx} .markerCore { fill: ${color}; } .markerT${idx} { filter: drop-shadow(0 0 10px ${color}); } .animT${idx} { transform-origin: 0px 0px; animation: climbT${idx} 12s linear infinite; }`;
    })
    .join("\n");

  const tierTicks = TIERS.map((tier) => {
    const y = roundPx(lpToY(tier.lpMin, ladderTop, ladderBottom));
    const color = p.theme.tier[tier.id];
    return `
      <g class="tier">
        <line x1="${ladderX0}" y1="${y}" x2="${ladderX1}" y2="${y}" stroke="${color}" stroke-opacity="0.35" stroke-width="2"/>
        <text x="${ladderX0 - 12}" y="${y + 5}" text-anchor="end" class="tierLabel">${esc(tier.label)}</text>
      </g>
    `;
  }).join("");

  const title = p.vs ? `${p.user} vs ${p.vs.user}` : p.user;

  const statsLine = (() => {
    const a = p.stats;
    const max = a.maxDay ? `${a.maxDay.count} on ${a.maxDay.date}` : "n/a";
    const busiest = a.busiestWeekday ? `${formatWeekday(a.busiestWeekday.weekday)}` : "n/a";
    return `Streak: ${a.currentStreakDays}d (best ${a.bestStreakDays}d) • 30d: ${a.last30DaysTotal} • Best day: ${max} • Busiest: ${busiest}`;
  })();

  const statsLine2 = (() => {
    if (!p.vs) return "";
    const a = p.vs.stats;
    const max = a.maxDay ? `${a.maxDay.count} on ${a.maxDay.date}` : "n/a";
    const busiest = a.busiestWeekday ? `${formatWeekday(a.busiestWeekday.weekday)}` : "n/a";
    return `VS Streak: ${a.currentStreakDays}d (best ${a.bestStreakDays}d) • 30d: ${a.last30DaysTotal} • Best day: ${max} • Busiest: ${busiest}`;
  })();

  const style = `
    :root{
      --bg:${p.theme.bg};
      --frame:${p.theme.frame};
      --text:${p.theme.text};
      --accent:${p.theme.accent};
      --glow:${p.theme.glow};
    }
    .frame{ fill: var(--bg); stroke: var(--frame); stroke-width: 2; }
    .title{ fill: var(--text); font: 700 16px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Arial; letter-spacing: 0.4px; }
    .sub{ fill: rgba(255,255,255,0.72); font: 500 12px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Arial; }
    .tierLabel{ fill: rgba(255,255,255,0.55); font: 700 10px/1 system-ui, -apple-system, Segoe UI, Roboto, Arial; letter-spacing: 0.8px; }
    .lpBox{ fill: rgba(255,255,255,0.04); stroke: rgba(255,255,255,0.10); stroke-width: 1; }
    .lpText{ fill: var(--text); font: 800 14px/1 system-ui, -apple-system, Segoe UI, Roboto, Arial; }
    .lpSmall{ fill: rgba(255,255,255,0.65); font: 600 11px/1 system-ui, -apple-system, Segoe UI, Roboto, Arial; }
    .ladderRail{ stroke: rgba(255,255,255,0.08); stroke-width: 10; stroke-linecap: round; }
    .ladderInner{ stroke: rgba(255,255,255,0.10); stroke-width: 2; stroke-linecap: round; }
    .marker{ filter: drop-shadow(0 0 10px var(--glow)); }
    .markerCore{ fill: var(--accent); }
    .markerRing{ fill: none; stroke: rgba(255,255,255,0.55); stroke-width: 1.5; }
    .marker2 .markerCore{ fill: rgba(255,255,255,0.88); }
    .marker2{ filter: drop-shadow(0 0 10px rgba(255,255,255,0.22)); }

    @keyframes climb { ${keyframes} }
    @keyframes climb2 { ${keyframes2} }
    .anim { transform-origin: 0px 0px; animation: climb 12s linear infinite; }
    .anim2 { transform-origin: 0px 0px; animation: climb2 12s linear infinite; }
    @media (prefers-reduced-motion: reduce) { .anim, .anim2 { animation: none; } }
  `;

  // Team block is appended only when team mode is active. Concatenated after
  // the base `style` so the primary-only / vs-only CSS output is byte-identical
  // to previous snapshot tests.
  const teamStyleBlock =
    teamMembers.length > 0
      ? `\n${teamKeyframes}\n${teamCss}\n@media (prefers-reduced-motion: reduce) { ${teamMembers
          .map((_, i) => `.animT${i}`)
          .join(", ")} { animation: none; } }\n`
      : "";
  const fullStyle = teamStyleBlock ? `${style}${teamStyleBlock}` : style;

  const lpLabel = head ? `${head.lp} LP` : "—";
  const lpLabel2 = head2 ? `${head2.lp} LP` : "";

  const markerX = ladderX1 - 10;
  const markerX2 = ladderX1 - 28;

  const hasStatic = typeof p.staticProgress === "number";
  const staticFrac = hasStatic ? clamp(p.staticProgress as number, 0, 1) : 0;
  const staticYA = (() => {
    if (!hasStatic || t0.length === 0) return ladderTop;
    const idx = Math.round(staticFrac * (t0.length - 1));
    return roundPx(lpToY(t0[idx]!.lp, ladderTop, ladderBottom));
  })();
  const staticYB = (() => {
    if (!hasStatic || !t1 || t1.length === 0) return ladderTop;
    const idx = Math.round(staticFrac * (t1.length - 1));
    return roundPx(lpToY(t1[idx]!.lp, ladderTop, ladderBottom));
  })();
  const markerClassA = hasStatic ? "marker" : "marker anim";
  const markerClassB = hasStatic ? "marker marker2" : "marker marker2 anim2";
  const markerYA = hasStatic ? staticYA : ladderTop;
  const markerYB = hasStatic ? staticYB : ladderTop;

  // Compact team badges, stacked under the primary LP badge. Uses height 30
  // with a 4 px gap so up to ~6 members fit inside a 400 px SVG.
  const teamBadgeHeight = 30;
  const teamBadgeGap = 4;
  const teamBadgesSvg = teamMembers
    .map((m, idx) => {
      const tlHead = teamTimelines[idx]!.at(-1);
      const lp = tlHead ? `${tlHead.lp} LP` : "—";
      const y = padding + headerH + 52 + idx * (teamBadgeHeight + teamBadgeGap);
      const color = TEAM_MARKER_COLORS[idx % TEAM_MARKER_COLORS.length]!;
      return `<g transform="translate(${padding + 16}, ${y})">
    <rect width="170" height="${teamBadgeHeight}" rx="8" class="lpBox"/>
    <rect x="8" y="${teamBadgeHeight / 2 - 5}" width="10" height="10" rx="2" fill="${color}"/>
    <text x="24" y="${teamBadgeHeight / 2 + 4}" class="lpSmall" font-weight="700">${esc(lp)}</text>
    <text x="74" y="${teamBadgeHeight / 2 + 4}" class="lpSmall">${esc(m.user)}</text>
  </g>`;
    })
    .join("\n  ");

  // Team markers, staggered 16 px left of the primary so they don't overlap.
  const teamMarkersSvg = teamMembers
    .map((_m, idx) => {
      const tl = teamTimelines[idx]!;
      const mx = markerX - (idx + 1) * 16;
      const staticY = (() => {
        if (!hasStatic || tl.length === 0) return ladderTop;
        const i = Math.round(staticFrac * (tl.length - 1));
        return roundPx(lpToY(tl[i]!.lp, ladderTop, ladderBottom));
      })();
      const my = hasStatic ? staticY : ladderTop;
      const cls = hasStatic ? `marker markerT${idx}` : `marker markerT${idx} animT${idx}`;
      return `<g transform="translate(${mx}, ${my})" class="${cls}">
    <circle cx="0" cy="0" r="6.5" class="markerCore"/>
    <circle cx="0" cy="0" r="10" class="markerRing"/>
  </g>`;
    })
    .join("\n  ");

  const footer = `
    <g transform="translate(${padding}, ${H - padding - 10})">
      <text class="sub">lp-climb • data: GitHub contributions • theme: ${esc(p.theme.name)}</text>
    </g>
  `;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Ranked climb ladder for ${esc(title)}">
  <style><![CDATA[${fullStyle}]]></style>

  <rect x="${padding}" y="${padding}" width="${W - padding * 2}" height="${H - padding * 2}" rx="16" class="frame"/>

  <g transform="translate(${padding + 16}, ${padding + 20})">
    <text class="title">${esc(title)} • Ranked Climb</text>
    <text class="sub" y="22">${esc(statsLine)}</text>
    ${p.vs ? `<text class="sub" y="40">${esc(statsLine2)}</text>` : ""}
  </g>

  <g>
    <line x1="${ladderX0}" y1="${ladderTop}" x2="${ladderX0}" y2="${ladderBottom}" class="ladderRail"/>
    <line x1="${ladderX0}" y1="${ladderTop}" x2="${ladderX0}" y2="${ladderBottom}" class="ladderInner"/>
    ${tierTicks}
  </g>

  <g transform="translate(${padding + 16}, ${padding + headerH})">
    <rect width="170" height="44" rx="10" class="lpBox"/>
    <text x="14" y="27" class="lpText">${esc(lpLabel)}</text>
    <text x="14" y="40" class="lpSmall">${esc(p.user)}</text>
  </g>

  ${
    p.vs
      ? `<g transform="translate(${padding + 16}, ${padding + headerH + 52})">
    <rect width="170" height="44" rx="10" class="lpBox"/>
    <text x="14" y="27" class="lpText">${esc(lpLabel2)}</text>
    <text x="14" y="40" class="lpSmall">${esc(p.vs.user)}</text>
  </g>`
      : ""
  }

  <g transform="translate(${markerX}, ${markerYA})" class="${markerClassA}">
    <circle cx="0" cy="0" r="7.5" class="markerCore"/>
    <circle cx="0" cy="0" r="11" class="markerRing"/>
  </g>

  ${
    p.vs
      ? `<g transform="translate(${markerX2}, ${markerYB})" class="${markerClassB}">
    <circle cx="0" cy="0" r="6.5" class="markerCore"/>
    <circle cx="0" cy="0" r="10" class="markerRing"/>
  </g>`
      : ""
  }
${teamBadgesSvg ? `  ${teamBadgesSvg}\n` : ""}${teamMarkersSvg ? `  ${teamMarkersSvg}\n` : ""}
  ${footer}
</svg>`;
}

export function renderRankedClimbPng(p: RenderParams): Buffer {
  const svg = renderRankedClimbSvg(p);
  const resvg = new Resvg(svg, {
    // Use the SVG's width/height; no external assets.
    background: p.theme.bg
  });
  return resvg.render().asPng();
}

/**
 * Rasterize the SVG once via resvg and return its raw RGBA pixel buffer plus
 * dimensions. Shared helper for WebP / AVIF encoders below.
 */
function rasterizeRgba(p: RenderParams): { pixels: Buffer; width: number; height: number } {
  const svg = renderRankedClimbSvg(p);
  const rendered = new Resvg(svg, { background: p.theme.bg }).render();
  // sharp expects a Node Buffer for raw input; resvg returns a Uint8Array.
  return {
    pixels: Buffer.from(rendered.pixels),
    width: rendered.width,
    height: rendered.height
  };
}

/**
 * Render the ranked climb as a still WebP image. Encodes via `sharp` from the
 * raw RGBA pixels produced by resvg. CPU cost is similar to the PNG path plus
 * one WebP encode.
 */
export async function renderRankedClimbWebp(
  p: RenderParams,
  opts: RenderRasterOptions = {}
): Promise<Buffer> {
  const quality = clamp(Math.round(opts.quality ?? 82), 0, 100);
  const { pixels, width, height } = rasterizeRgba(p);
  return sharp(pixels, { raw: { width, height, channels: 4 } })
    .webp({ quality, effort: 4 })
    .toBuffer();
}

/**
 * Render the ranked climb as a still AVIF image. Encodes via `sharp`. AVIF
 * encode is notably slower than WebP; callers should cache aggressively and
 * consider a lower `quality` default (55) for reasonable file sizes.
 */
export async function renderRankedClimbAvif(
  p: RenderParams,
  opts: RenderRasterOptions = {}
): Promise<Buffer> {
  const quality = clamp(Math.round(opts.quality ?? 55), 0, 100);
  const { pixels, width, height } = rasterizeRgba(p);
  return sharp(pixels, { raw: { width, height, channels: 4 } })
    .avif({ quality, effort: 4 })
    .toBuffer();
}

/**
 * Render the ranked climb as an animated GIF. Expensive: each frame is a full
 * SVG→raster pass via resvg, then quantized and appended to the GIF. Callers
 * should cache aggressively and keep `frames`/`fps`/`width`/`height` small.
 */
export function renderRankedClimbGif(p: RenderParams, opts: RenderGifOptions = {}): Buffer {
  const frames = clamp(Math.round(opts.frames ?? 24), 6, 60);
  const fps = clamp(Math.round(opts.fps ?? 12), 4, 30);
  const delayMs = Math.round(1000 / fps);

  const gif = GIFEncoder();
  let lastWidth = 0;
  let lastHeight = 0;

  for (let i = 0; i < frames; i++) {
    // Loop cleanly: last frame should land just shy of 1.0 so the next loop
    // iteration wraps back to 0 without a visible duplicate hold.
    const progress = i / frames;
    const svg = renderRankedClimbSvg({ ...p, staticProgress: progress });
    const rendered = new Resvg(svg, { background: p.theme.bg }).render();
    const { width, height } = rendered;
    const pixels = rendered.pixels;
    lastWidth = width;
    lastHeight = height;

    const palette = quantize(pixels, 256);
    const index = applyPalette(pixels, palette);
    gif.writeFrame(index, width, height, { palette, delay: delayMs });
  }

  gif.finish();
  // Guard: if somehow no frames were written (empty timeline), still produce a
  // 1x1 transparent GIF rather than throwing — keeps the endpoint resilient.
  if (lastWidth === 0 || lastHeight === 0) {
    const emptyGif = GIFEncoder();
    const pixels = new Uint8Array([0, 0, 0, 0]);
    const palette = quantize(pixels, 2);
    const index = applyPalette(pixels, palette);
    emptyGif.writeFrame(index, 1, 1, { palette, delay: delayMs });
    emptyGif.finish();
    return Buffer.from(emptyGif.bytes());
  }
  return Buffer.from(gif.bytes());
}

