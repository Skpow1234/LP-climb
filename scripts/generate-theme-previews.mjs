import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Use compiled JS from dist so this script is runtime-simple.
const themesMod = await import(pathToFileUrl(path.join(root, "packages/themes/dist/index.js")));
const svgMod = await import(pathToFileUrl(path.join(root, "packages/svg-creator/dist/index.js")));
const coreMod = await import(pathToFileUrl(path.join(root, "packages/core/dist/index.js")));

const THEMES = themesMod.THEMES;
const renderRankedClimbSvg = svgMod.renderRankedClimbSvg;
const computeStats = coreMod.computeStats;

const outDir = path.join(root, "docs", "theme-previews");
fs.mkdirSync(outDir, { recursive: true });

// Create synthetic 53 weeks x 7 days contribution cells.
// Dates don't matter much for rendering; stats use them, so keep them valid and sequential.
function makeCells() {
  const start = new Date(Date.UTC(2024, 0, 1));
  const cells = [];
  let dayIndex = 0;
  for (let x = 0; x < 53; x++) {
    for (let y = 0; y < 7; y++) {
      const d = new Date(start.getTime() + dayIndex * 24 * 60 * 60 * 1000);
      const iso = d.toISOString().slice(0, 10);

      // deterministic pattern with some “spikes” and “off days”
      const base = (x * 7 + y) % 17;
      const spike = (x % 9 === 0 && y === 2) || (x % 13 === 0 && y === 5);
      const off = (x % 8 === 0 && y % 3 === 0) || (x % 11 === 0 && y === 0);
      const count = off ? 0 : spike ? 42 : base;

      const level = count === 0 ? 0 : count < 4 ? 1 : count < 9 ? 2 : count < 16 ? 3 : 4;
      cells.push({ x, y, date: iso, count, level });
      dayIndex++;
    }
  }
  return cells;
}

function pathToFileUrl(p) {
  const u = new URL("file:///");
  u.pathname = p.replace(/\\/g, "/");
  return u.toString();
}

const user = "theme-preview";
const cells = makeCells();
const stats = computeStats(cells);

for (const [id, theme] of Object.entries(THEMES)) {
  const svg = renderRankedClimbSvg({
    user,
    cells,
    stats,
    theme,
    width: 900,
    height: 260
  });

  const filename = path.join(outDir, `${id}.svg`);
  fs.writeFileSync(filename, svg);
  process.stdout.write(`wrote ${path.relative(root, filename)}\n`);
}

