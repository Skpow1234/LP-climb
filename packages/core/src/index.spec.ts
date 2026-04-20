import { describe, expect, it } from "vitest";
import type { ContributionCell } from "@lp-climb/types";
import { TIERS, clamp, computeLpTimeline, computeStats, lpDeltaFromCount } from "./index.js";

// Helper to build a cell from a zero-based day offset since 2024-01-01. The
// weekday (`y`) is derived from the offset so streak tests stay realistic.
function cell(dayOffset: number, count: number, overrides: Partial<ContributionCell> = {}) {
  const base = Date.UTC(2024, 0, 1);
  const d = new Date(base + dayOffset * 24 * 60 * 60 * 1000);
  const iso = d.toISOString().slice(0, 10);
  const weekday = d.getUTCDay();
  const level = (count === 0 ? 0 : count < 4 ? 1 : count < 9 ? 2 : count < 16 ? 3 : 4) as
    | 0
    | 1
    | 2
    | 3
    | 4;
  return {
    x: Math.floor(dayOffset / 7),
    y: weekday,
    date: iso,
    count,
    level,
    ...overrides
  };
}

describe("computeStats", () => {
  it("returns a zero/null-shaped stats object for an empty contribution set", () => {
    const s = computeStats([]);
    expect(s.total).toBe(0);
    expect(s.maxDay).toBeNull();
    expect(s.currentStreakDays).toBe(0);
    expect(s.bestStreakDays).toBe(0);
    expect(s.busiestWeekday).toBeNull();
    expect(s.last30DaysTotal).toBe(0);
  });

  it("sums totals and picks the busiest day regardless of input order", () => {
    const cells = [cell(0, 2), cell(2, 7), cell(1, 5)];
    const s = computeStats(cells);
    expect(s.total).toBe(14);
    expect(s.maxDay).toEqual({ date: cells[1]!.date, count: 7 });
  });

  it("tracks best streak across gaps and current streak anchored to the final cell", () => {
    // 3-day streak (0..2), gap on day 3, 2-day streak (4..5). Current streak
    // anchors at the end → 2 days; best streak → 3 days.
    const cells = [cell(0, 1), cell(1, 2), cell(2, 3), cell(3, 0), cell(4, 1), cell(5, 4)];
    const s = computeStats(cells);
    expect(s.bestStreakDays).toBe(3);
    expect(s.currentStreakDays).toBe(2);
  });

  it("returns streak = 0 when the last day has no contributions", () => {
    const cells = [cell(0, 5), cell(1, 5), cell(2, 0)];
    expect(computeStats(cells).currentStreakDays).toBe(0);
  });

  it("last30DaysTotal only counts the trailing 30-day window", () => {
    const cells: ContributionCell[] = [];
    for (let i = 0; i < 60; i++) cells.push(cell(i, 1));
    // Trailing window is inclusive on both ends (30 days → 30 counts).
    expect(computeStats(cells).last30DaysTotal).toBe(30);
  });

  it("busiestWeekday tallies by weekday index, not calendar date", () => {
    // All contribs on Monday (weekday 1) across different weeks.
    const mondays = [cell(1, 10), cell(8, 3), cell(15, 5)];
    const s = computeStats(mondays);
    expect(s.busiestWeekday?.weekday).toBe(mondays[0]!.y);
    expect(s.busiestWeekday?.total).toBe(18);
  });

  it("rejects malformed date strings loudly", () => {
    expect(() => computeStats([{ x: 0, y: 0, date: "not-a-date", count: 1, level: 1 }])).toThrow();
  });
});

describe("lpDeltaFromCount", () => {
  it("penalizes zero-contribution days", () => {
    expect(lpDeltaFromCount(0)).toBe(-4);
    expect(lpDeltaFromCount(-5)).toBe(-4); // defensive: any non-positive
  });

  it("is monotonic non-decreasing as count grows", () => {
    let prev = lpDeltaFromCount(1);
    for (const n of [2, 3, 5, 8, 10, 15, 20, 30, 35, 50, 55, 100, 10_000]) {
      const v = lpDeltaFromCount(n);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("caps at +50 for very heavy days", () => {
    expect(lpDeltaFromCount(56)).toBe(50);
    expect(lpDeltaFromCount(1000)).toBe(50);
  });
});

describe("computeLpTimeline", () => {
  it("returns an empty timeline for an empty input", () => {
    expect(computeLpTimeline([])).toEqual([]);
  });

  it("starts from the silver floor (800 LP) and monotonically applies deltas", () => {
    const cells = [cell(0, 0), cell(1, 10), cell(2, 30)];
    const t = computeLpTimeline(cells);
    expect(t.length).toBe(3);
    expect(t[0]!.delta).toBe(-4);
    expect(t[0]!.lp).toBe(800 - 4);
    expect(t[1]!.lp).toBe(t[0]!.lp + lpDeltaFromCount(10));
    expect(t[2]!.lp).toBe(t[1]!.lp + lpDeltaFromCount(30));
  });

  it("clamps LP inside [iron.min, challenger.max] even for long streaks", () => {
    const cells: ContributionCell[] = [];
    for (let i = 0; i < 400; i++) cells.push(cell(i, 100));
    const t = computeLpTimeline(cells);
    const last = t.at(-1)!;
    expect(last.lp).toBeLessThanOrEqual(TIERS.at(-1)!.lpMax);
    expect(last.lp).toBeGreaterThanOrEqual(TIERS[0]!.lpMin);
  });

  it("sorts input by date before accumulating", () => {
    const unordered = [cell(2, 10), cell(0, 5), cell(1, 3)];
    const t = computeLpTimeline(unordered);
    const dates = t.map((x) => x.date);
    const sorted = [...dates].sort();
    expect(dates).toEqual(sorted);
  });
});

describe("TIERS table", () => {
  it("is contiguous: each tier's lpMin == previous tier's lpMax + 1", () => {
    for (let i = 1; i < TIERS.length; i++) {
      expect(TIERS[i]!.lpMin).toBe(TIERS[i - 1]!.lpMax + 1);
    }
  });

  it("starts at 0 and ends at 3999 (10 tiers × 400 LP each)", () => {
    expect(TIERS[0]!.lpMin).toBe(0);
    expect(TIERS.at(-1)!.lpMax).toBe(3999);
    expect(TIERS.length).toBe(10);
  });
});

describe("clamp", () => {
  it("passes through values in range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });
  it("clamps on both ends", () => {
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });
});
