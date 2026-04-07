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

const apiBase = (process.env.LP_CLIMB_API_BASE || "http://localhost:3000").replace(/\/+$/, "");

await rm(outDir);
await copyDir(publicDir, outDir);

await fs.writeFile(
  path.join(outDir, "config.js"),
  `window.LP_CLIMB_DEMO = ${JSON.stringify({ apiBase })};\n`,
  "utf8",
);

console.log(`demo built -> ${path.relative(process.cwd(), outDir)} (apiBase=${apiBase})`);

