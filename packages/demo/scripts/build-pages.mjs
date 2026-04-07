import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");
const outDir = path.join(root, "dist");

async function rm(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}

async function copyDir(src, dst) {
  await fs.mkdir(dst, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) await copyDir(s, d);
    else if (e.isFile()) await fs.copyFile(s, d);
  }
}

const raw = (process.env.LP_CLIMB_API_BASE || "").trim();

// On GitHub Pages deploy, we never want to silently ship "localhost".
if (process.env.GITHUB_ACTIONS && !raw) {
  throw new Error(
    "LP_CLIMB_API_BASE is required in CI. Set repo variable LP_CLIMB_API_BASE to your hosted API base URL (e.g. https://lp-climb.onrender.com).",
  );
}

const apiBase = (raw || "http://localhost:3000").replace(/\/+$/, "");

await rm(outDir);
await copyDir(publicDir, outDir);

await fs.writeFile(
  path.join(outDir, "config.js"),
  `window.LP_CLIMB_DEMO = ${JSON.stringify({ apiBase, builtAt: new Date().toISOString() })};\n`,
  "utf8",
);

console.log(`demo built -> ${path.relative(process.cwd(), outDir)} (apiBase=${apiBase})`);

