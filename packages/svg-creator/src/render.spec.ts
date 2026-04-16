import { describe, expect, it } from "vitest";
import { computeStats } from "@lp-climb/core";
import type { ContributionCell } from "@lp-climb/types";
import { THEMES } from "@lp-climb/themes";
import { renderProfileCardSvg, renderRankedClimbSvg } from "./index.js";

function makeSyntheticCells(): ContributionCell[] {
  const start = new Date(Date.UTC(2024, 0, 1));
  const cells: ContributionCell[] = [];
  let dayIndex = 0;
  for (let x = 0; x < 53; x++) {
    for (let y = 0; y < 7; y++) {
      const d = new Date(start.getTime() + dayIndex * 24 * 60 * 60 * 1000);
      const iso = d.toISOString().slice(0, 10);

      const base = (x * 7 + y) % 17;
      const spike = (x % 9 === 0 && y === 2) || (x % 13 === 0 && y === 5);
      const off = (x % 8 === 0 && y % 3 === 0) || (x % 11 === 0 && y === 0);
      const count = off ? 0 : spike ? 42 : base;
      const level = (count === 0 ? 0 : count < 4 ? 1 : count < 9 ? 2 : count < 16 ? 3 : 4) as
        | 0
        | 1
        | 2
        | 3
        | 4;

      cells.push({ x, y, date: iso, count, level });
      dayIndex++;
    }
  }
  return cells;
}

describe("renderRankedClimbSvg determinism", () => {
  it("renders stable output for each theme (snapshot)", () => {
    const cells = makeSyntheticCells();
    const stats = computeStats(cells);

    const out = Object.keys(THEMES)
      .sort()
      .map((id) => {
        const theme = (THEMES as any)[id];
      const svg = renderRankedClimbSvg({
        user: "snapshot-user",
        cells,
        stats,
        theme,
        width: 900,
        height: 260,
        // Pin legacy ladder output so this snapshot keeps matching byte-for-byte
        // after the default style flipped to "card".
        style: "ladder"
      });
      return `--- theme:${id} ---\n${svg}\n`;
    });

    // Normalize line endings so snapshots match on Windows + Linux runners.
    const normalized = out
      .join("\n")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/[ \t]+$/gm, "");
    expect(normalized).toMatchSnapshot();
  });

  it("is identical across repeated calls", () => {
    const cells = makeSyntheticCells();
    const stats = computeStats(cells);
    const theme = THEMES.rift;

    const a = renderRankedClimbSvg({ user: "u", cells, stats, theme, width: 900, height: 260, style: "ladder" });
    const b = renderRankedClimbSvg({ user: "u", cells, stats, theme, width: 900, height: 260, style: "ladder" });

    expect(a).toEqual(b);
  });

  it("renders team mode with distinct markers + badges per member", () => {
    const cells = makeSyntheticCells();
    const stats = computeStats(cells);
    const theme = THEMES.rift;

    const svg = renderRankedClimbSvg({
      user: "alice",
      cells,
      stats,
      theme,
      width: 900,
      height: 400,
      style: "ladder",
      team: [
        { user: "bob", cells, stats },
        { user: "carol", cells, stats },
        { user: "dave", cells, stats }
      ]
    });

    // Structural assertions — the renderer emits one keyframe / anim rule and
    // one marker per team member, plus a badge with their login.
    for (const idx of [0, 1, 2]) {
      expect(svg).toContain(`@keyframes climbT${idx}`);
      expect(svg).toContain(`animT${idx}`);
      expect(svg).toContain(`markerT${idx}`);
    }
    expect(svg).toContain(">bob</text>");
    expect(svg).toContain(">carol</text>");
    expect(svg).toContain(">dave</text>");
  });

  it("ignores team when vs is set (vs-mode output is unchanged)", () => {
    const cells = makeSyntheticCells();
    const stats = computeStats(cells);
    const theme = THEMES.rift;

    const vsOnly = renderRankedClimbSvg({
      user: "alice",
      cells,
      stats,
      theme,
      style: "ladder",
      vs: { user: "bob", cells, stats }
    });

    const vsWithIgnoredTeam = renderRankedClimbSvg({
      user: "alice",
      cells,
      stats,
      theme,
      style: "ladder",
      vs: { user: "bob", cells, stats },
      team: [{ user: "carol", cells, stats }]
    });

    expect(vsWithIgnoredTeam).toEqual(vsOnly);
  });
});

describe("renderProfileCardSvg determinism", () => {
  it("renders stable card output for each theme (snapshot)", () => {
    const cells = makeSyntheticCells();
    const stats = computeStats(cells);

    const out = Object.keys(THEMES)
      .sort()
      .map((id) => {
        const theme = (THEMES as any)[id];
        const svg = renderProfileCardSvg({
          user: "snapshot-user",
          cells,
          stats,
          theme,
          width: 900,
          height: 260
        });
        return `--- theme:${id} ---\n${svg}\n`;
      });

    const normalized = out
      .join("\n")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/[ \t]+$/gm, "");
    expect(normalized).toMatchSnapshot();
  });

  it("is identical across repeated calls", () => {
    const cells = makeSyntheticCells();
    const stats = computeStats(cells);
    const theme = THEMES.rift;

    const a = renderProfileCardSvg({ user: "u", cells, stats, theme, width: 900, height: 260 });
    const b = renderProfileCardSvg({ user: "u", cells, stats, theme, width: 900, height: 260 });

    expect(a).toEqual(b);
  });

  it("emits the expected structural pieces", () => {
    const cells = makeSyntheticCells();
    const stats = computeStats(cells);
    const theme = THEMES.rift;

    const svg = renderProfileCardSvg({
      user: "snapshot-user",
      cells,
      stats,
      theme,
      width: 900,
      height: 260
    });

    // Hex badge + division + stars + top-% + 5 metric bars.
    expect(svg).toContain("hexBadge");
    expect(svg).toContain("class=\"division\"");
    expect(svg).toMatch(/>Top \d+%</);
    expect(svg).toMatch(/>IV<|>III<|>II<|>I</);
    // One row per metric.
    for (const label of ["Commits", "Streak", "Best", "30d", "Best day"]) {
      expect(svg).toContain(`>${label}</text>`);
    }
    // 5 bar fills + 5 tracks.
    const trackCount = (svg.match(/class="barTrack"/g) ?? []).length;
    const fillCount = (svg.match(/class="barFill/g) ?? []).length;
    expect(trackCount).toBe(5);
    expect(fillCount).toBe(5);
    // Primary user only: no `vs` or team markers.
    expect(svg).not.toContain("marker2");
    expect(svg).not.toContain("markerT0");
  });

  it("top-level dispatcher selects card by default and ladder when requested", () => {
    const cells = makeSyntheticCells();
    const stats = computeStats(cells);
    const theme = THEMES.rift;

    const defaultSvg = renderRankedClimbSvg({ user: "u", cells, stats, theme });
    const cardSvg = renderRankedClimbSvg({ user: "u", cells, stats, theme, style: "card" });
    const ladderSvg = renderRankedClimbSvg({ user: "u", cells, stats, theme, style: "ladder" });

    expect(defaultSvg).toEqual(cardSvg);
    expect(defaultSvg).not.toEqual(ladderSvg);
    expect(cardSvg).toContain("hexBadge");
    expect(ladderSvg).toContain("ladderRail");
  });
});

