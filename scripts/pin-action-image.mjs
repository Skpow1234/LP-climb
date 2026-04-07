import fs from "node:fs";

const digest = process.argv[2];
const repo = process.argv[3];

if (!digest || !digest.startsWith("sha256:")) {
  console.error('Usage: node scripts/pin-action-image.mjs "sha256:..." "OWNER/REPO"');
  process.exit(2);
}
if (!repo || !repo.includes("/")) {
  console.error('Usage: node scripts/pin-action-image.mjs "sha256:..." "OWNER/REPO"');
  process.exit(2);
}

const pinned = `docker://ghcr.io/${repo}-action@${digest}`;
const file = new URL("../action.yml", import.meta.url);
const actionYml = fs.readFileSync(file, "utf8");

const next = actionYml.replace(
  /(^runs:\s*\n(?:.*\n)*?\s*image:\s*)(.+)\s*$/m,
  `$1${pinned}`
);

if (next === actionYml) {
  console.error("Failed to update action.yml (pattern not found).");
  process.exit(3);
}

fs.writeFileSync(file, next);
console.log(`Pinned action image to ${pinned}`);

