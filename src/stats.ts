import type { ContributionCell } from "./github/contributions.js";

export type ContributionStats = {
  total: number;
  maxDay: { date: string; count: number } | null;
  currentStreakDays: number;
  bestStreakDays: number;
  busiestWeekday: { weekday: number; total: number } | null;
  last30DaysTotal: number;
};

function isoToTime(date: string): number {
  // Date.parse treats YYYY-MM-DD as UTC in modern JS runtimes; good enough here.
  const t = Date.parse(date);
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
  for (const c of sorted) {
    weekdayTotals.set(c.y, (weekdayTotals.get(c.y) ?? 0) + c.count);
  }
  const busiestWeekday = (() => {
    let best: { weekday: number; total: number } | null = null;
    for (const [weekday, t] of weekdayTotals.entries()) {
      if (!best || t > best.total) best = { weekday, total: t };
    }
    return best;
  })();

  // streaks: consecutive calendar days with count > 0
  let bestStreakDays = 0;
  let currentStreakDays = 0;
  let running = 0;
  let prevDayT: number | null = null;

  for (const c of sorted) {
    const t = isoToTime(c.date);
    const isNext =
      prevDayT === null ? true : t - prevDayT === 24 * 60 * 60 * 1000;

    if (!isNext) running = 0;
    if (c.count > 0) running += 1;
    else running = 0;

    bestStreakDays = Math.max(bestStreakDays, running);
    prevDayT = t;
  }

  // current streak is the streak ending on the last date present
  running = 0;
  prevDayT = null;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const c = sorted[i]!;
    const t = isoToTime(c.date);
    const isPrev =
      prevDayT === null ? true : prevDayT - t === 24 * 60 * 60 * 1000;
    if (!isPrev) break;
    if (c.count > 0) running += 1;
    else break;
    prevDayT = t;
  }
  currentStreakDays = running;

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

  return {
    total,
    maxDay,
    currentStreakDays,
    bestStreakDays,
    busiestWeekday,
    last30DaysTotal
  };
}

