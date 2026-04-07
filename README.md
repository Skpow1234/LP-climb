# LP Climb

[![ci](https://img.shields.io/github/actions/workflow/status/Skpow1234/LP-climb/ci.yml?label=ci&style=flat-square)](https://github.com/Skpow1234/LP-climb/actions/workflows/ci.yml)
[![release](https://img.shields.io/github/v/release/Skpow1234/LP-climb?style=flat-square)](https://github.com/Skpow1234/LP-climb/releases/latest)
[![license](https://img.shields.io/github/license/Skpow1234/LP-climb?style=flat-square)](./LICENSE)
![types](https://img.shields.io/badge/types-typescript-blue?style=flat-square)
![code style](https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=flat-square)

League-inspired **Ranked Climb Ladder** animation powered by **GitHub contribution data**.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/theme-previews/assassin.svg" />
  <source media="(prefers-color-scheme: light)" srcset="docs/theme-previews/rift.svg" />
  <img alt="lp-climb preview" src="docs/theme-previews/rift.svg" />
</picture>

## Live demo

- **GitHub Pages**: `https://skpow1234.github.io/LP-climb/`

## Ways to use LP Climb

- **GitHub Action**: generate `dist/*.svg` in a workflow (recommended for profile READMEs).
- **Nightly “output branch” publishing**: auto-push generated SVGs to an `output` branch (for `raw.githubusercontent.com/...` embeds).
- **Hosted API**: request `/v1/render.svg` on-demand (great for apps + dashboards).
- **GitHub Pages demo**: a static UI where users type a username/theme and preview the ladder (calls your hosted API).
- **Docker**: run the API locally, or run the action image as a container.

## Recipes (copy/paste)

### 1) Profile README (recommended)

Use the action to generate to `dist/`, then push `dist/` to `output` (via `nightly.yml`).

**Outputs**:

```text
dist/lp.svg?theme=rift
dist/lp-dark.svg?theme=assassin
```

**Embed**:

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/<OWNER>/<REPO>/output/lp-dark.svg" />
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/<OWNER>/<REPO>/output/lp.svg" />
  <img alt="LP Climb" src="https://raw.githubusercontent.com/<OWNER>/<REPO>/output/lp.svg" />
</picture>
```

### 2) On-demand (apps / dashboards)

```text
https://<API_HOST>/v1/render.svg?user=octocat&theme=rift&width=900&height=260
```

PNG:

```text
https://<API_HOST>/v1/render.png?user=octocat&theme=rift&width=900&height=260
```

### 3) 1v1 ladder (VS)

```text
https://<API_HOST>/v1/render.svg?user=octocat&vs=torvalds&theme=rift
```

## API endpoints (hosted render service)

- `GET /v1/render.svg?user=USER&theme=rift` (**recommended**)
  - Legacy alias: `GET /render.svg?...` (deprecated)
  - Optional: `&vs=OTHER_USER` for 1v1 comparison
  - Optional: `&width=900&height=260`
- `GET /v1/render.png?user=USER&theme=rift`
  - Legacy alias: `GET /render.png?...`
- `GET /v1/meta.json?user=USER` (**recommended**)
  - Legacy alias: `GET /meta.json?...` (deprecated)
  - Optional: `&vs=OTHER_USER`
- `GET /v1/themes.json` (theme catalog)
- `GET /v1/healthz` (**recommended**)
  - Legacy alias: `GET /healthz`

## GitHub Action (generate SVGs in workflows)

### Use the action

In this repo (local workflow testing):

- `uses: ./`

Published usage (after you release tags):

- `uses: Skpow1234/LP-climb@vX.Y.Z`

Example:

```yaml
- uses: Skpow1234/LP-climb@v0.1.0
  with:
    github_user_name: ${{ github.repository_owner }}
    outputs: |
      dist/lp.svg?theme=rift
      dist/lp-dark.svg?theme=assassin
      dist/lp-vs.svg?theme=rift&vs=torvalds
```

### Publish to an `output` branch (snk-style)

This is the simplest way to embed SVGs into a profile README: generate to `dist/`, then push `dist/` to an `output` branch.

- Use `.github/workflows/nightly.yml` (already included in this repo).
- Result files end up at:
  - `https://raw.githubusercontent.com/<OWNER>/<REPO>/output/lp.svg`
  - `https://raw.githubusercontent.com/<OWNER>/<REPO>/output/lp-dark.svg`

Embed example (dark/light):

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/<OWNER>/<REPO>/output/lp-dark.svg" />
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/<OWNER>/<REPO>/output/lp.svg" />
  <img alt="LP Climb" src="https://raw.githubusercontent.com/<OWNER>/<REPO>/output/lp.svg" />
</picture>
```

## GitHub Pages demo (static UI)

This repo includes a static demo site that can be deployed to **GitHub Pages**. The demo site **does not** call GitHub directly; it calls your hosted LP Climb API.

Live demo (GitHub Pages):

- `https://skpow1234.github.io/LP-climb/`

### Deploy

1) Enable Pages: **Repo Settings → Pages → Source: GitHub Actions**
2) Set an Actions variable:
   - **Name**: `LP_CLIMB_API_BASE`
   - **Value**: your hosted API base URL (example: `https://lp-climb-api.example.com`)
3) Push to `main` (or run workflow `pages` manually)

The workflow is: `.github/workflows/pages.yml`.

### Local build (static)

```bash
npm install --workspaces --include-workspace-root
npm --workspace packages/demo run build:pages
```

Outputs: `packages/demo/dist/`

## Hosted API

### Local (dev)

```bash
## Requires Bun installed (see https://bun.sh)
bun install
cp .env.example .env
bun run dev
```

### npm fallback (if you don't want Bun)

```bash
npm install --workspaces --include-workspace-root
cp .env.example .env
npm run dev:npm
```

Then open:

- `http://localhost:3000/render.svg?user=octocat&theme=rift`
- `http://localhost:3000/render.svg?user=octocat&vs=torvalds&theme=assassin`

### Call the hosted API directly

Example URLs:

- `/v1/render.svg?user=octocat&theme=rift`
- `/v1/render.svg?user=octocat&theme=rift&vs=torvalds`
- `/v1/meta.json?user=octocat`

Tip: SVG is easiest to use via `<img src="...">` (no CORS needed). If you `fetch()` JSON (`meta.json`) from a browser demo, you may want to enable CORS on the API.

## Demo playground (local dev server)

Start the API first, then the demo dev server:

```bash
# terminal 1
bun run dev

# terminal 2
bun run demo
```

Demo UI:

- `http://localhost:5173`

## Docker

```bash
cp .env.example .env
docker compose up --build
```

### Publishing (prod)

To make pipelines “real” (pinned, reproducible), publish images to GHCR:

- Run workflow `publish-action-image` to push the action image.
  - It prints a pinned reference like:
    - `docker://ghcr.io/OWNER/REPO-action@sha256:...`
  - It also **commits the pin** back into `action.yml`.
- Run workflow `publish-api-image` to push the API service image.
- Or: push a git tag like `v0.1.0` to trigger the `release` workflow, which builds/pushes both images and creates a GitHub Release.

Then deploy the API image anywhere that can run a container (VM, Fly.io, Render, Railway, Kubernetes).

## Themes

`theme` supports:

- `rift` (default)
- `assassin`, `mage`, `tank`, `support`, `marksman`
- `mono`

### Theme catalog

List all themes + their colors:

- `GET /v1/themes.json`

### Recommended dark/light pairs

Pick any combination, but these pairs read well on GitHub:

| Light | Dark |
| --- | --- |
| `rift` | `assassin` |
| `support` | `mage` |
| `marksman` | `tank` |
| `mono` | `mono` |

### Custom theme params (optional)

You can override colors directly in the render URL (useful for personalization / “champion select”):

- **base colors**: `bg`, `frame`, `text`, `accent`, `glow`
- **tier colors**: `tier_iron`, `tier_bronze`, `tier_silver`, `tier_gold`, `tier_plat`, `tier_emerald`, `tier_diamond`, `tier_master`, `tier_grandmaster`, `tier_challenger`

Example:

```text
/v1/render.svg?user=octocat&theme=rift&accent=%23ff00aa&bg=%23000000&tier_challenger=%23ffd36b
```

### Dark / light pairing (recommended)

Generate 2 outputs and embed with `<picture>`:

- `dist/lp.svg?theme=rift`
- `dist/lp-dark.svg?theme=assassin`

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/<OWNER>/<REPO>/output/lp-dark.svg" />
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/<OWNER>/<REPO>/output/lp.svg" />
  <img alt="LP Climb" src="https://raw.githubusercontent.com/<OWNER>/<REPO>/output/lp.svg" />
</picture>
```

## Troubleshooting

- **Demo/preview shows nothing**: open the generated SVG URL in a new tab. If you see JSON like `{ "error": "...", "message": "..." }`, the API is returning an error (rate limit / bad token / invalid username).
- **Render root shows 404**: use `/v1/healthz` (the API does not serve `/`).
- **SVG looks “transparent” on some backgrounds**: use a theme with an explicit `bg` (all built-in themes include `bg`) or pass `&bg=%23000000`.

### Theme previews

Run:

```bash
npm run theme-previews
```

Outputs are written to `docs/theme-previews/*.svg`.
