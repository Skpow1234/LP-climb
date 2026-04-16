import type { ContributionStats, Theme } from "@lp-climb/types";
import { clamp, computeLpTimeline, TIERS } from "@lp-climb/core";
import type { RenderParams } from "./index.js";

/**
 * Profile-card renderer. Outputs a GitHub-tier style card (hex badge + 5
 * progress bars) as an alternative to the horizontal ladder. Inputs are the
 * same `RenderParams` the ladder uses so every rasterizer path (PNG / WebP /
 * AVIF / GIF) can reuse it unchanged.
 *
 * Card mode renders the primary user only. When `vs` or `team` are set the
 * renderer intentionally ignores them (same silent-ignore contract the ladder
 * uses for `team` when `vs` is set). Compare views continue to work great in
 * `?style=ladder`.
 */

const DIV_ROMANS = ["IV", "III", "II", "I"] as const;

function esc(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function roundPx(n: number) {
  return Math.round(n * 1000) / 1000;
}

function fmtCompact(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(n));
}

type TierProgress = {
  tierId: string;
  tierLabel: string;
  division: string;
  divIdx: number;
  stars: number;
  lpToNext: number;
  nextLabel: string;
  topPct: number;
  tierColor: string;
};

function tierProgress(lp: number, theme: Theme): TierProgress {
  const minLp = TIERS[0]!.lpMin;
  const maxLp = TIERS.at(-1)!.lpMax;
  const bounded = clamp(lp, minLp, maxLp);

  let tierIdx = 0;
  for (let i = 0; i < TIERS.length; i++) {
    if (bounded >= TIERS[i]!.lpMin && bounded <= TIERS[i]!.lpMax) {
      tierIdx = i;
      break;
    }
  }
  const tier = TIERS[tierIdx]!;
  const tierRange = tier.lpMax - tier.lpMin + 1;
  const divisionSize = tierRange / 4;
  const lpInTier = bounded - tier.lpMin;
  const divIdx = Math.min(3, Math.floor(lpInTier / divisionSize));
  const division = DIV_ROMANS[divIdx]!;
  const stars = divIdx + 1;

  const nextDivLp = tier.lpMin + (divIdx + 1) * divisionSize;
  const lpToNext = Math.max(0, Math.round(nextDivLp - bounded));
  const nextLabel =
    divIdx < 3
      ? `${tier.label} ${DIV_ROMANS[divIdx + 1]!}`
      : tierIdx < TIERS.length - 1
      ? `${TIERS[tierIdx + 1]!.label} IV`
      : "MAX";

  const totalRange = maxLp - minLp;
  const frac = totalRange > 0 ? (bounded - minLp) / totalRange : 0;
  const topPct = Math.max(1, Math.round((1 - frac) * 100));

  return {
    tierId: tier.id,
    tierLabel: tier.label,
    division,
    divIdx,
    stars,
    lpToNext,
    nextLabel,
    topPct,
    tierColor: theme.tier[tier.id]
  };
}

type MetricRow = {
  icon: "commits" | "streak" | "best" | "month" | "bestDay";
  label: string;
  value: string;
  score: number;
};

function computeMetricRows(stats: ContributionStats): MetricRow[] {
  // Reference ceilings chosen so a very active developer (~daily commits,
  // ~year-long streak) tops out near 100 on most bars. Tuned against the
  // sample in the reference mock (1.3k commits ≈ 84/100).
  const ceil = {
    commits: 1550,
    streak: 100,
    best: 200,
    month: 200,
    bestDay: 40
  };
  const s = (v: number, c: number) =>
    Math.max(0, Math.min(100, Math.round((v / c) * 100)));

  const maxCount = stats.maxDay?.count ?? 0;
  return [
    { icon: "commits", label: "Commits", value: fmtCompact(stats.total), score: s(stats.total, ceil.commits) },
    { icon: "streak", label: "Streak", value: `${stats.currentStreakDays}d`, score: s(stats.currentStreakDays, ceil.streak) },
    { icon: "best", label: "Best", value: `${stats.bestStreakDays}d`, score: s(stats.bestStreakDays, ceil.best) },
    { icon: "month", label: "30d", value: fmtCompact(stats.last30DaysTotal), score: s(stats.last30DaysTotal, ceil.month) },
    { icon: "bestDay", label: "Best day", value: fmtCompact(maxCount), score: s(maxCount, ceil.bestDay) }
  ];
}

function hexPath(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = ((90 - i * 60) * Math.PI) / 180;
    const x = cx + r * Math.cos(angle);
    const y = cy - r * Math.sin(angle);
    pts.push(`${roundPx(x)},${roundPx(y)}`);
  }
  return `M ${pts.join(" L ")} Z`;
}

function starPath(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.42;
    const angle = ((90 - i * 36) * Math.PI) / 180;
    const x = cx + rad * Math.cos(angle);
    const y = cy - rad * Math.sin(angle);
    pts.push(`${roundPx(x)},${roundPx(y)}`);
  }
  return `M ${pts.join(" L ")} Z`;
}

/**
 * Tiny icon glyph for a metric row. All icons occupy a ~14x14 box centered at
 * (0, 0) so the row renderer can translate once and draw the icon + label
 * inline. Fills use the `.rowIcon` CSS class's stroke/fill (accent color).
 */
function metricIcon(kind: MetricRow["icon"]): string {
  switch (kind) {
    case "commits":
      return `<circle cx="0" cy="0" r="2.5" class="iconFill"/><circle cx="0" cy="0" r="6" class="iconStroke"/>`;
    case "streak":
      return `<path d="M 0 -7 C 3 -3 5 -1 5 2 C 5 5 2.5 7 0 7 C -2.5 7 -5 5 -5 2 C -5 0 -3 -2 -1.5 -1 C -2 -3 -1 -5 0 -7 Z" class="iconFill"/>`;
    case "best":
      return `<path d="${starPath(0, 0, 6)}" class="iconFill"/>`;
    case "month":
      return `<rect x="-6" y="-5" width="12" height="11" rx="1.5" class="iconStroke"/><rect x="-6" y="-5" width="12" height="3" class="iconFill"/><rect x="-4" y="-7" width="1.4" height="3" class="iconFill"/><rect x="2.6" y="-7" width="1.4" height="3" class="iconFill"/>`;
    case "bestDay":
      return `<path d="M 0 -6 L 6 0 L 0 6 L -6 0 Z" class="iconFill"/>`;
  }
}

export function renderProfileCardSvg(p: RenderParams): string {
  const W = p.width ?? 900;
  const H = p.height ?? 260;

  const padding = 18;
  const innerX = padding;
  const innerY = padding;
  const innerW = W - padding * 2;
  const innerH = H - padding * 2;

  const timeline = computeLpTimeline(p.cells);
  const headLp = timeline.at(-1)?.lp ?? TIERS[0]!.lpMin;
  const prog = tierProgress(headLp, p.theme);
  const metrics = computeMetricRows(p.stats);

  const hasStatic = typeof p.staticProgress === "number";
  const animProgress = hasStatic ? clamp(p.staticProgress as number, 0, 1) : 1;

  // Header block: avatar + identity (left), hex badge (right).
  const headerH = Math.min(96, Math.max(72, Math.round(innerH * 0.42)));
  const headerY = innerY + 16;

  const avatarCx = innerX + 20 + 22;
  const avatarCy = headerY + 22;
  const avatarInitial = (p.user.trim().charAt(0) || "?").toUpperCase();

  const identityX = avatarCx + 36;
  const nameY = headerY + 10;
  const handleY = headerY + 30;
  const topY = headerY + 50;
  const promoY = headerY + 66;

  const hexR = Math.min(40, Math.max(26, Math.round(headerH * 0.46)));
  const hexCx = innerX + innerW - hexR - 12;
  const hexCy = headerY + hexR + 4;
  const tierNameY = hexCy - hexR - 8;
  const starsY = hexCy + hexR + 14;

  // Bars area.
  const barsTop = innerY + headerH + 22;
  const barsBottom = innerY + innerH - 28;
  const rowCount = metrics.length;
  const rowGap = 6;
  const rowH = Math.max(
    14,
    Math.floor((barsBottom - barsTop - rowGap * (rowCount - 1)) / rowCount)
  );

  const barLeft = innerX + 80;
  const barRight = innerX + innerW - 88;
  const barTrackW = Math.max(40, barRight - barLeft);

  const footerY = innerY + innerH - 6;

  const tierColor = prog.tierColor;
  const accent = p.theme.accent;

  // Stars row under the hex badge. Filled = prog.stars; ring otherwise.
  const starSize = 5;
  const starGap = 3;
  const starsTotalW = 4 * (starSize * 2) + 3 * starGap;
  const starsStartX = hexCx - starsTotalW / 2 + starSize;
  const starsSvg = Array.from({ length: 4 }, (_, i) => {
    const cx = starsStartX + i * (starSize * 2 + starGap);
    const filled = i < prog.stars;
    const path = starPath(cx, starsY, starSize);
    return `<path d="${path.slice(2)}" fill="${filled ? tierColor : "none"}" stroke="${filled ? tierColor : "rgba(255,255,255,0.35)"}" stroke-width="1.2"/>`;
  }).join("");

  // Bar rows SVG. Each row: icon glyph + label + progress track + fill + value + score/100.
  const barsSvg = metrics
    .map((m, i) => {
      const y = barsTop + i * (rowH + rowGap);
      const rowCy = y + rowH / 2;
      const fillW = roundPx((barTrackW * m.score * animProgress) / 100);
      const animStyle = hasStatic ? "" : ` style="animation-delay:${(i * 80) / 1000}s"`;
      return `
  <g transform="translate(0, 0)" class="row row${i}">
    <g transform="translate(${innerX + 16}, ${rowCy})" class="rowIcon">${metricIcon(m.icon)}</g>
    <text x="${innerX + 30}" y="${rowCy + 4}" class="rowLabel">${esc(m.label)}</text>
    <rect x="${barLeft}" y="${rowCy - 4}" width="${barTrackW}" height="8" rx="4" class="barTrack"/>
    <rect x="${barLeft}" y="${rowCy - 4}" width="${fillW}" height="8" rx="4" class="barFill ${hasStatic ? "" : "barFillAnim"}"${animStyle}/>
    <text x="${barRight + 10}" y="${rowCy + 4}" class="rowValue">${esc(m.value)}</text>
    <text x="${innerX + innerW - 14}" y="${rowCy + 4}" class="rowScore" text-anchor="end"><tspan class="rowScoreNum">${m.score}</tspan> / 100</text>
  </g>`;
    })
    .join("");

  const pulseAnim = hasStatic
    ? ""
    : `@keyframes hexPulse { 0%,100% { filter: drop-shadow(0 0 6px ${accent}); } 50% { filter: drop-shadow(0 0 18px ${accent}); } }
       .hexBadge { animation: hexPulse 3.6s ease-in-out infinite; transform-origin: center; }
       @keyframes barGrow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
       .barFillAnim { transform-origin: left center; animation: barGrow 1.8s cubic-bezier(0.22, 0.9, 0.3, 1) both; }
       @media (prefers-reduced-motion: reduce) { .hexBadge, .barFillAnim { animation: none; } .barFillAnim { transform: none; } }`;

  const style = `
    :root{
      --bg:${p.theme.bg};
      --frame:${p.theme.frame};
      --text:${p.theme.text};
      --accent:${accent};
      --glow:${p.theme.glow};
      --tier:${tierColor};
    }
    .frame{ fill: var(--bg); stroke: var(--frame); stroke-width: 2; }
    .name{ fill: var(--text); font: 800 20px/1.1 system-ui, -apple-system, Segoe UI, Roboto, Arial; letter-spacing: 0.2px; }
    .handle{ fill: var(--accent); font: 700 12px/1.1 system-ui, -apple-system, Segoe UI, Roboto, Arial; }
    .topPct{ fill: var(--accent); font: 800 13px/1.1 system-ui, -apple-system, Segoe UI, Roboto, Arial; letter-spacing: 0.3px; }
    .promo{ fill: rgba(255,255,255,0.55); font: 500 11px/1.1 system-ui, -apple-system, Segoe UI, Roboto, Arial; }
    .tierName{ fill: var(--tier); font: 800 12px/1 system-ui, -apple-system, Segoe UI, Roboto, Arial; letter-spacing: 1.2px; }
    .division{ fill: var(--text); font: 800 16px/1 system-ui, -apple-system, Segoe UI, Roboto, Arial; letter-spacing: 1px; }
    .rowLabel{ fill: rgba(255,255,255,0.82); font: 700 12px/1 system-ui, -apple-system, Segoe UI, Roboto, Arial; }
    .iconFill{ fill: var(--accent); }
    .iconStroke{ fill: none; stroke: var(--accent); stroke-width: 1.4; }
    .rowValue{ fill: var(--text); font: 800 13px/1 system-ui, -apple-system, Segoe UI, Roboto, Arial; text-anchor: end; }
    .rowScore{ fill: rgba(255,255,255,0.45); font: 600 11px/1 system-ui, -apple-system, Segoe UI, Roboto, Arial; }
    .rowScoreNum{ fill: var(--text); font-weight: 800; }
    .barTrack{ fill: rgba(255,255,255,0.06); }
    .barFill{ fill: var(--accent); }
    .avatarRing{ fill: none; stroke: var(--accent); stroke-width: 2; }
    .avatarBg{ fill: rgba(255,255,255,0.06); }
    .avatarLetter{ fill: var(--accent); font: 800 20px/1 system-ui, -apple-system, Segoe UI, Roboto, Arial; text-anchor: middle; }
    .hexFill{ fill: var(--tier); fill-opacity: 0.22; stroke: var(--tier); stroke-width: 2; }
    .hexInner{ fill: none; stroke: rgba(255,255,255,0.10); stroke-width: 1; }
    .footer{ fill: rgba(255,255,255,0.45); font: 500 10px/1 system-ui, -apple-system, Segoe UI, Roboto, Arial; }
    ${pulseAnim}
  `;

  const hexOuter = hexPath(hexCx, hexCy, hexR);
  const hexInner = hexPath(hexCx, hexCy, hexR - 5);

  const title = `Profile tier card for ${p.user}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">
  <style><![CDATA[${style}]]></style>

  <rect x="${innerX}" y="${innerY}" width="${innerW}" height="${innerH}" rx="16" class="frame"/>

  <g class="avatar">
    <circle cx="${avatarCx}" cy="${avatarCy}" r="22" class="avatarBg"/>
    <circle cx="${avatarCx}" cy="${avatarCy}" r="22" class="avatarRing"/>
    <text x="${avatarCx}" y="${avatarCy + 7}" class="avatarLetter">${esc(avatarInitial)}</text>
  </g>

  <g class="identity">
    <text x="${identityX}" y="${nameY + 8}" class="name">${esc(p.user)}</text>
    <text x="${identityX}" y="${handleY + 4}" class="handle">@${esc(p.user)}</text>
    <text x="${identityX}" y="${topY + 4}" class="topPct">Top ${prog.topPct}%</text>
    <text x="${identityX}" y="${promoY + 4}" class="promo">+${prog.lpToNext} LP to ${esc(prog.nextLabel)}</text>
  </g>

  <g class="hexBadge">
    <text x="${hexCx}" y="${tierNameY}" class="tierName" text-anchor="middle">${esc(prog.tierLabel)}</text>
    <path d="${hexOuter}" class="hexFill"/>
    <path d="${hexInner}" class="hexInner"/>
    <text x="${hexCx}" y="${hexCy + 6}" class="division" text-anchor="middle">${esc(prog.division)}</text>
    ${starsSvg}
  </g>

  ${barsSvg}

  <text x="${innerX + 4}" y="${footerY}" class="footer">lp-climb • data: GitHub contributions • theme: ${esc(p.theme.name)}</text>
</svg>`;
}
