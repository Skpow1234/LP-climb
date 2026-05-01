import type { ContributionCell, ContributionStats } from "@lp-climb/types";

function isoToTime(date: string): number {
  // Ensure consistent parsing across runtimes/timezones.
  // YYYY-MM-DD is not always parsed consistently as UTC vs local.
  const t = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(t)) throw new Error(`Invalid date: ${date}`);
  return t;
}

export function computeStats(cells: ContributionCell[]): ContributionStats {
  const sorted = [...cells].sort((a, b) => isoToTime(a.date) - isoToTime(b.date));

  const total = sorted.reduce((s, c) => s + c.count, 0);
  const maxDay =
    sorted.length === 0
      ? null
      : sorted.reduce(
          (m, c) => (c.count > m.count ? { date: c.date, count: c.count } : m),
          { date: sorted[0]!.date, count: sorted[0]!.count }
        );

  const weekdayTotals = new Map<number, number>();
  for (const c of sorted) weekdayTotals.set(c.y, (weekdayTotals.get(c.y) ?? 0) + c.count);

  const busiestWeekday = (() => {
    let best: { weekday: number; total: number } | null = null;
    for (const [weekday, t] of weekdayTotals.entries()) {
      if (!best || t > best.total) best = { weekday, total: t };
    }
    return best;
  })();

  let bestStreakDays = 0;
  let running = 0;
  let prevDayT: number | null = null;

  for (const c of sorted) {
    const t = isoToTime(c.date);
    const isNext = prevDayT === null ? true : t - prevDayT === 24 * 60 * 60 * 1000;
    if (!isNext) running = 0;
    if (c.count > 0) running += 1;
    else running = 0;
    bestStreakDays = Math.max(bestStreakDays, running);
    prevDayT = t;
  }

  running = 0;
  prevDayT = null;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const c = sorted[i]!;
    const t = isoToTime(c.date);
    const isPrev = prevDayT === null ? true : prevDayT - t === 24 * 60 * 60 * 1000;
    if (!isPrev) break;
    if (c.count > 0) running += 1;
    else break;
    prevDayT = t;
  }
  const currentStreakDays = running;

  const last30DaysTotal = (() => {
    if (sorted.length === 0) return 0;
    const end = isoToTime(sorted.at(-1)!.date);
    const start = end - 29 * 24 * 60 * 60 * 1000;
    return sorted
      .filter((c) => {
        const t = isoToTime(c.date);
        return t >= start && t <= end;
      })
      .reduce((s, c) => s + c.count, 0);
  })();

  return { total, maxDay, currentStreakDays, bestStreakDays, busiestWeekday, last30DaysTotal };
}

export type TierId =
  | "iron"
  | "bronze"
  | "silver"
  | "gold"
  | "plat"
  | "emerald"
  | "diamond"
  | "master"
  | "grandmaster"
  | "challenger";

export const TIERS: { id: TierId; label: string; lpMin: number; lpMax: number }[] = [
  { id: "iron", label: "IRON", lpMin: 0, lpMax: 399 },
  { id: "bronze", label: "BRONZE", lpMin: 400, lpMax: 799 },
  { id: "silver", label: "SILVER", lpMin: 800, lpMax: 1199 },
  { id: "gold", label: "GOLD", lpMin: 1200, lpMax: 1599 },
  { id: "plat", label: "PLAT", lpMin: 1600, lpMax: 1999 },
  { id: "emerald", label: "EMERALD", lpMin: 2000, lpMax: 2399 },
  { id: "diamond", label: "DIAMOND", lpMin: 2400, lpMax: 2799 },
  { id: "master", label: "MASTER", lpMin: 2800, lpMax: 3199 },
  { id: "grandmaster", label: "GRANDMASTER", lpMin: 3200, lpMax: 3599 },
  { id: "challenger", label: "CHALLENGER", lpMin: 3600, lpMax: 3999 }
];

export function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

export function lpDeltaFromCount(count: number) {
  if (count <= 0) return -4;
  if (count <= 2) return 6;
  if (count <= 5) return 10;
  if (count <= 10) return 16;
  if (count <= 20) return 22;
  if (count <= 35) return 30;
  if (count <= 55) return 38;
  return 50;
}

export type LpTimelinePoint = {
  date: string;
  lp: number;
  delta: number;
};

export function computeLpTimeline(cells: ContributionCell[]) {
  const sorted = [...cells].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const out: LpTimelinePoint[] = [];
  let lp = 800;
  for (const c of sorted) {
    const delta = lpDeltaFromCount(c.count);
    lp = clamp(lp + delta, TIERS[0]!.lpMin, TIERS.at(-1)!.lpMax);
    out.push({ date: c.date, lp, delta });
  }
  return out;
}

