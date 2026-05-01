# LP Climb

[![ci](https://img.shields.io/github/actions/workflow/status/Skpow1234/LP-climb/ci.yml?label=ci&style=flat-square)](https://github.com/Skpow1234/LP-climb/actions/workflows/ci.yml)
[![release](https://img.shields.io/github/v/release/Skpow1234/LP-climb?style=flat-square)](https://github.com/Skpow1234/LP-climb/releases/latest)
[![license](https://img.shields.io/github/license/Skpow1234/LP-climb?style=flat-square)](./LICENSE)
[![docs](https://img.shields.io/badge/api-swagger-85ea2d?style=flat-square&logo=swagger&logoColor=black)](https://lp-climb.onrender.com/docs)
![types](https://img.shields.io/badge/types-typescript-blue?style=flat-square)
![code style](https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=flat-square)

League-inspired **Ranked Climb** visualizations powered by your **GitHub contribution data** — rendered as a tier card or as an animated horizontal ladder, in SVG / PNG / WebP / AVIF / GIF.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/theme-previews/assassin.svg" />
  <source media="(prefers-color-scheme: light)" srcset="docs/theme-previews/rift.svg" />
  <img alt="LP Climb preview" src="docs/theme-previews/rift.svg" />
</picture>

## Table of contents

- [Live demo & docs](#live-demo--docs)
- [Quick start — pick a path](#quick-start--pick-a-path)
- [Visualization styles: card vs ladder](#visualization-styles-card-vs-ladder)
- [Recipes (copy-paste URLs)](#recipes-copy-paste-urls)
- [API reference](#api-reference)
- [Themes & customization](#themes--customization)
- [GitHub Action](#github-action)
- [Static demo site (GitHub Pages)](#static-demo-site-github-pages)
- [Self-host the API](#self-host-the-api)
- [Observability](#observability)
- [API compatibility & deprecation](#api-compatibility--deprecation)
- [Troubleshooting](#troubleshooting)
- [Project layout & contributing](#project-layout--contributing)

## Live demo & docs

- **Demo UI:** <https://skpow1234.github.io/LP-climb/> — type a username, pick a style/theme, get an embed URL.
- **Hosted API:** <https://lp-climb.onrender.com> (free tier; cold starts possible).
- **Interactive API docs:** <https://lp-climb.onrender.com/docs> — Swagger UI; "Try it out" works against the live API.
- **OpenAPI spec:** <https://lp-climb.onrender.com/openapi.json> — point your codegen at this.

## Quick start — pick a path

LP Climb is delivered three ways. Pick whichever matches what you're trying to embed.

| Path | Best for | Cost | Setup |
| --- | --- | --- | --- |
| **A. GitHub Action → `output` branch** | Profile READMEs (most popular) | Free (GitHub Actions minutes) | One workflow file |
| **B. Hosted API `<img src>`** | Any README, dashboard, or app | Free public service | Zero — just paste a URL |
| **C. Self-host the API** | Private dashboards, custom themes, high traffic | You pay for the host | Docker / Node |

### A. Profile README via the Action

1. Add `.github/workflows/nightly.yml` (already in this repo) to your repository.
2. The workflow runs the action, generates SVGs into `dist/`, and pushes them to an `output` branch.
3. Embed the raw URLs in your `README.md`:

```html
<picture>
  <source media="(prefers-color-scheme: dark)"  srcset="https://raw.githubusercontent.com/<OWNER>/<REPO>/output/lp-dark.svg" />
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/<OWNER>/<REPO>/output/lp.svg" />
  <img alt="LP Climb" src="https://raw.githubusercontent.com/<OWNER>/<REPO>/output/lp.svg" />
</picture>
```

Full action reference: [GitHub Action](#github-action).

### B. Just paste an `<img>` URL

```html
<img alt="LP Climb"
     src="https://lp-climb.onrender.com/v1/render.svg?user=octocat&theme=rift&style=card" />
```

That's it — no auth, no token, embeddable from any origin (`Cross-Origin-Resource-Policy: cross-origin` is set on every render response).

### C. Run it yourself

```bash
git clone https://github.com/Skpow1234/LP-climb.git
cd LP-climb
cp .env.example .env          # set GITHUB_TOKEN
docker compose up --build     # API on http://localhost:3000
```

Or without Docker — see [Self-host the API](#self-host-the-api).

## Visualization styles: card vs ladder

The same data, two views. Selected with the `style` query parameter.

| Style | What you get | Supports `vs` / `team`? | Default? |
| --- | --- | --- | --- |
| **`card`** | GitHub-style tier card (avatar, current tier badge, LP, streaks). Compact, README-friendly. | No — primary user only. `vs` / `team` are silently ignored in card mode. | ✅ default |
| **`ladder`** | Horizontal climb ladder with tier ticks, animated marker(s), and per-climber LP badges. | Yes — `vs` (1v1) or `team` (up to 5 extras). | Opt in with `&style=ladder`. |

```text
# Card (default)
https://lp-climb.onrender.com/v1/render.svg?user=octocat&theme=rift

# Ladder, single user
https://lp-climb.onrender.com/v1/render.svg?user=octocat&theme=rift&style=ladder

# Ladder, 1v1
https://lp-climb.onrender.com/v1/render.svg?user=octocat&vs=torvalds&theme=rift&style=ladder

# Ladder, team (up to 5 extras → 6 climbers total)
https://lp-climb.onrender.com/v1/render.svg?user=octocat&team=torvalds,gaearon,sindresorhus&theme=rift&style=ladder&preset=banner
```

> **Heads up.** The current GitHub Action only renders `card` style and only honors `theme` / `width` / `height` / `vs` per output line (and `vs` is ignored by the card renderer). If you need ladder / team / GIF in a profile README, generate via the hosted API in the action workflow (or self-host) and curl the result into `dist/` instead.

## Recipes (copy-paste URLs)

Replace `<API_HOST>` with `lp-climb.onrender.com` (or your self-hosted host). All URLs accept the same theme + dimension + override params (see [Themes & customization](#themes--customization)).

### Vector (SVG)

```text
<API_HOST>/v1/render.svg?user=octocat&theme=rift                       # card, default size
<API_HOST>/v1/render.svg?user=octocat&theme=rift&style=ladder           # animated ladder
<API_HOST>/v1/render.svg?user=octocat&theme=rift&preset=banner          # named size preset
```

### Raster (PNG / WebP / AVIF) — for sites that strip animations

```text
<API_HOST>/v1/render.png?user=octocat&theme=rift
<API_HOST>/v1/render.webp?user=octocat&theme=rift&quality=82            # default 82
<API_HOST>/v1/render.avif?user=octocat&theme=rift&quality=55            # smaller; slower encode
```

### Animated GIF (CPU-heavy — cache aggressively)

```text
<API_HOST>/v1/render.gif?user=octocat&theme=rift&style=ladder&frames=24&fps=12
```

`frames` is clamped to 6–60, `fps` to 4–30. Each frame is a full SVG → raster pass; keep dimensions modest.

### 1v1 ladder

```text
<API_HOST>/v1/render.svg?user=octocat&vs=torvalds&theme=rift&style=ladder
```

### Team ladder (1 + up to 5 = 6 climbers)

```text
<API_HOST>/v1/render.svg?user=octocat&team=torvalds,gaearon,sindresorhus&theme=rift&style=ladder&preset=banner
```

`team` accepts up to **5** extra usernames (so **6 climbers total** including the primary). Combining `vs` and `team` returns `400`. Bump the canvas (e.g. `preset=banner` or `&height=400`) so all badges fit.

### Stats only (no image)

```text
<API_HOST>/v1/meta.json?user=octocat                                   # primary stats
<API_HOST>/v1/meta.json?user=octocat&vs=torvalds                       # + 1v1
<API_HOST>/v1/meta.json?user=octocat&team=torvalds,gaearon              # + team
```

### Raw contribution cells (for custom UIs)

```text
<API_HOST>/v1/github-contrib/octocat
```

Returns `{ user, fetchedAt, stale, days, cells: [{ x, y, date, count, level }, ...] }` and shares the SWR cache with the render endpoints — calling this warms render cache and vice versa.

## API reference

> **Browse interactively:** <https://lp-climb.onrender.com/docs> (Swagger UI). Every route, parameter, and response is documented there with a live "Try it out" panel. The raw OpenAPI 3 document is at [`/openapi.json`](https://lp-climb.onrender.com/openapi.json).

### Endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /v1/render.svg` | Vector render. **Recommended.** |
| `GET /v1/render.png` | Rasterized via resvg. |
| `GET /v1/render.webp` | Smaller than PNG. `quality` 1–100 (default 82). |
| `GET /v1/render.avif` | Smallest at equivalent quality; slower encode. `quality` default 55. |
| `GET /v1/render.gif` | Animated. `frames` 6–60, `fps` 4–30. |
| `GET /v1/meta.json` | JSON stats for the primary user (and optional `vs` / `team`). |
| `GET /v1/github-contrib/:user` | Normalized contribution cells. |
| `GET /v1/themes.json` | Theme catalog (live). |
| `GET /v1/presets.json` | Dimension preset catalog. |
| `GET /v1/healthz` | Liveness probe. |
| `GET /v1/metrics` | Prometheus text exposition (alias: `GET /metrics`). |

Legacy unversioned aliases (`/render.svg`, `/render.png`, `/meta.json`, `/healthz`) are still served and emit `Deprecation` / `Sunset` / `Link` headers. See [API compatibility & deprecation](#api-compatibility--deprecation).

### Common query parameters

| Parameter | Where | Notes |
| --- | --- | --- |
| `user` | required, all render + meta routes | GitHub login (1–39 chars, no leading/trailing/double `-`). |
| `style` | `render.*` | `card` (default) or `ladder`. Card is primary-only. |
| `theme` | `render.*`, `meta.json` | One of the [theme ids](#themes). Defaults to `rift`. |
| `vs` | `render.*` (ladder), `meta.json` | Second GitHub login. Mutually exclusive with `team`. |
| `team` | `render.*` (ladder), `meta.json` | Up to 5 comma-separated extra logins. Mutually exclusive with `vs`. |
| `width`, `height` | `render.*` | `width` 500–2000, `height` 180–900. Override `preset`. |
| `preset` | `render.*` | Named size — see `/v1/presets.json`. |
| Color overrides | `render.*` | `bg`, `frame`, `text`, `accent`, `glow`, `tier_iron` … `tier_challenger`. URL-encoded color string. |
| `quality` | `render.webp`, `render.avif` | 1–100. |
| `frames`, `fps` | `render.gif` | 6–60 / 4–30. |

### Response semantics & caching

All render and meta responses share an in-memory **stale-while-revalidate LRU**:

- `Cache-Control: public, max-age=…, stale-while-revalidate=…`
- `ETag` on render / meta / `github-contrib` responses, with `304 Not Modified` support via `If-None-Match`
- `X-Cache: miss | hit | stale` — `stale` means cached value returned immediately while a background refresh runs.
- `X-Request-Id` — generated per request (or echoed from your proxy's `X-Request-Id` header).
- `Cross-Origin-Resource-Policy: cross-origin` on render + meta routes (configurable; see env vars).
- Rate-limit headers: `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, plus `Retry-After` on 429.

Errors return a JSON body of the shape `{ "error": "<code>", "message": "<text>" }`:

- `400 bad_request` — Zod validation failure (bad query, `vs` + `team` combined, etc.).
- `429` — rate-limited; honor `Retry-After`.
- `5xx internal_error` / upstream codes from `GithubContribError` (e.g. unknown user, GitHub rate-limited).

## Themes & customization

### Themes

Built-in `theme` ids:

| Id | Name | Preview |
| --- | --- | --- |
| `rift` | Rift _(default)_ | [`docs/theme-previews/rift.svg`](docs/theme-previews/rift.svg) |
| `assassin` | Assassin | [`docs/theme-previews/assassin.svg`](docs/theme-previews/assassin.svg) |
| `mage` | Mage | [`docs/theme-previews/mage.svg`](docs/theme-previews/mage.svg) |
| `tank` | Tank | [`docs/theme-previews/tank.svg`](docs/theme-previews/tank.svg) |
| `support` | Support | [`docs/theme-previews/support.svg`](docs/theme-previews/support.svg) |
| `marksman` | Marksman | [`docs/theme-previews/marksman.svg`](docs/theme-previews/marksman.svg) |
| `mono` | Mono _(grayscale)_ | [`docs/theme-previews/mono.svg`](docs/theme-previews/mono.svg) |

Pull the live catalog with all colors: `GET /v1/themes.json`.

#### Suggested dark/light pairs

These pair well in a `<picture>` element when GitHub's preferred-color-scheme switches:

| Light source | Dark source |
| --- | --- |
| `rift` | `assassin` |
| `support` | `mage` |
| `marksman` | `tank` |
| `mono` | `mono` |

### Presets

Skip the `width`/`height` math — pass a `preset` (live list at `/v1/presets.json`):

| Preset | Dimensions |
| --- | --- |
| `readme` | 900 × 260 |
| `readme-wide` | 1100 × 280 |
| `readme-compact` | 720 × 200 |
| `profile` | 600 × 240 |
| `banner` | 1200 × 300 |
| `badge` | 500 × 180 |

Explicit `width` / `height` always override the preset.

### Color overrides ("champion select")

Any color in a theme can be overridden per-request. URL-encode `#` as `%23`:

```text
/v1/render.svg?user=octocat&theme=rift&accent=%23ff00aa&bg=%23000000&tier_challenger=%23ffd36b
```

- **Base:** `bg`, `frame`, `text`, `accent`, `glow`
- **Tiers:** `tier_iron`, `tier_bronze`, `tier_silver`, `tier_gold`, `tier_plat`, `tier_emerald`, `tier_diamond`, `tier_master`, `tier_grandmaster`, `tier_challenger`

### Regenerate the preview SVGs

```bash
npm run build:npm        # build packages first (the script imports the dist outputs)
npm run theme-previews   # writes docs/theme-previews/*.svg
```

## GitHub Action

The composite action runs as a Docker container (`Dockerfile.action`) and writes one or more SVG/PNG files for the requested user.

### Inputs

| Input | Required | Default | Notes |
| --- | --- | --- | --- |
| `github_user_name` | yes | — | GitHub login to render. |
| `github_token` | no | `${{ github.token }}` | Used for the GraphQL contribution query. Read-only — `${{ github.token }}` is sufficient. |
| `outputs` | no | `dist/lp.svg?theme=rift` | Multiline list. Each line is `path/to/file.{svg,png,webp,avif,gif}?<query>`. |

### Supported query parameters

The output parser now accepts the same surface as the hosted API:

- **Theme + dims:** `theme`, `preset` *(hosted API only — parse locally via `width`/`height`)*, `width`, `height`
- **Style / climbers:** `style=card|ladder`, `vs=login`, `team=a,b,c` (comma-separated; max 5; ladder only)
- **Color overrides:** `bg`, `frame`, `text`, `accent`, `glow`, `tier_iron` … `tier_challenger` (`#rrggbb`, URL-encode `#` as `%23`)
- **Encoder tuning:** `quality` (webp/avif, 0–100), `frames` (gif, 6–60), `fps` (gif, 4–30)

### Example

```yaml
- uses: Skpow1234/LP-climb@v0.1.0
  with:
    github_user_name: ${{ github.repository_owner }}
    outputs: |
      dist/lp.svg?theme=rift&width=900&height=260
      dist/lp-dark.svg?theme=assassin&width=900&height=260
      dist/lp-ladder.svg?style=ladder&theme=rift&vs=torvalds&width=1200&height=300
      dist/lp-team.svg?style=ladder&theme=rift&team=torvalds,gaearon,tj&width=1200&height=300
      dist/lp-champion.svg?theme=rift&accent=%23ff2d55&bg=%23120015&width=900&height=260
      dist/lp.webp?theme=rift&quality=90&width=900&height=260
      dist/lp.gif?style=ladder&theme=rift&frames=24&fps=12&width=1200&height=300
```

`vs` and `team` are mutually exclusive. In `style=card` the action silently ignores both (matching the hosted API), so reach for `style=ladder` when you want side-by-side or team output.

### Push the result to an `output` branch

The simplest way to embed in a profile README. The bundled `.github/workflows/nightly.yml` runs the action, then uses `crazy-max/ghaction-github-pages` with `target_branch: output` to push `dist/` to a long-lived `output` branch:

- Runs nightly at 03:00 UTC, on push to `main`, and on `workflow_dispatch`.
- Result files end up at `https://raw.githubusercontent.com/<OWNER>/<REPO>/output/lp.svg` etc.

For a one-off generation that uploads an artifact instead of pushing, use `.github/workflows/manual-run.yml`.

## Static demo site (GitHub Pages)

The repo includes a static demo (`packages/demo`) deployable to **GitHub Pages**. It does not call GitHub directly — it calls your hosted LP Climb API.

### Deploy

1. **Enable Pages:** Repo Settings → Pages → Source: GitHub Actions.
2. **Set an Actions variable:**
   - Name: `LP_CLIMB_API_BASE`
   - Value: your API base URL (e.g. `https://lp-climb.onrender.com`).
3. Push to `main` (or run the `pages` workflow manually).

The workflow lives at `.github/workflows/pages.yml`.

### Build statically (locally)

```bash
npm install --workspaces --include-workspace-root
LP_CLIMB_API_BASE="https://lp-climb.onrender.com" \
  npm --workspace packages/demo run build:pages
# output: packages/demo/dist/
```

### Run the demo with hot reload (against a local API)

```bash
# terminal 1 — API
bun run dev          # or: npm run dev:npm

# terminal 2 — demo
bun run demo         # serves http://localhost:5173, proxies to http://localhost:3000
```

## Self-host the API

### Local development

Bun (preferred):

```bash
bun install
cp .env.example .env     # set GITHUB_TOKEN
bun run dev              # http://localhost:3000
```

npm fallback:

```bash
npm install --workspaces --include-workspace-root
cp .env.example .env
npm run dev:npm
```

Sanity check:

```text
http://localhost:3000/v1/healthz
http://localhost:3000/docs
http://localhost:3000/v1/render.svg?user=octocat&theme=rift
http://localhost:3000/v1/render.svg?user=octocat&vs=torvalds&theme=assassin&style=ladder
http://localhost:3000/v1/render.gif?user=octocat&theme=rift&style=ladder&frames=18&fps=12
http://localhost:3000/v1/presets.json
http://localhost:3000/v1/github-contrib/octocat
```

### Docker

The compose file uses the Node-based image at `Dockerfile.api` (port 3000):

```bash
cp .env.example .env
docker compose up --build
```

A Bun-based `Dockerfile` is also included as an alternative; pick whichever fits your runtime preferences. For CI/CD-driven publishing, see the workflows under `.github/workflows/release.yml`, `publish-api-image.yml`, and `publish-action-image.yml`. They push images to GHCR and pin the action image digest into `action.yml`. Production checklist: [`docs/prod.md`](docs/prod.md).

### Environment variables

All read by `packages/api/src/env.ts` (see [`.env.example`](.env.example) for a copy-paste template):

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP listen port. |
| `HOST` | `0.0.0.0` | Bind address. |
| `GITHUB_TOKEN` | _(required)_ | Token for GitHub GraphQL contribution queries. Needs no scopes (public data). |
| `CACHE_TTL_SECONDS` | `21600` (6 h) | Legacy fallback fresh window. Used when a per-route TTL below is not set. |
| `CACHE_STALE_SECONDS` | `86400` (24 h) | Legacy fallback stale window. Used when a per-route stale window below is not set. |
| `CACHE_CONTRIB_TTL_SECONDS` | `21600` (6 h) | Fresh window for cached GitHub contribution payloads. Defaults to `CACHE_TTL_SECONDS`. |
| `CACHE_CONTRIB_STALE_SECONDS` | `86400` (24 h) | Stale window for cached GitHub contribution payloads. Defaults to `CACHE_STALE_SECONDS`. |
| `CACHE_SVG_TTL_SECONDS` | `21600` (6 h) | Fresh window for SVG renders. Defaults to `CACHE_TTL_SECONDS`. |
| `CACHE_SVG_STALE_SECONDS` | `86400` (24 h) | Stale window for SVG renders. Defaults to `CACHE_STALE_SECONDS`. |
| `CACHE_META_TTL_SECONDS` | `7200` (2 h) | Fresh window for `meta.json` responses. Shorter because they are cheap to recompute and more likely to be consumed programmatically. |
| `CACHE_META_STALE_SECONDS` | `21600` (6 h) | Stale window for `meta.json` responses. |
| `CACHE_RASTER_TTL_SECONDS` | `43200` (12 h) | Fresh window for PNG / WebP / AVIF renders. Longer because rasterization is more expensive. |
| `CACHE_RASTER_STALE_SECONDS` | `172800` (48 h) | Stale window for PNG / WebP / AVIF renders. |
| `CACHE_GIF_TTL_SECONDS` | `86400` (24 h) | Fresh window for GIF renders. Longest by default because GIF generation is the most CPU-expensive path. |
| `CACHE_GIF_STALE_SECONDS` | `259200` (72 h) | Stale window for GIF renders. |
| `CACHE_REFRESH_JITTER_MS` | `2500` | Best-effort per-key refresh staggering window for stale background revalidation across multiple API instances. Set `0` to disable. |
| `CACHE_INSTANCE_ID` | `<hostname>:<pid>` | Stable instance identifier used to derive deterministic refresh jitter. Set explicitly in multi-instance deployments if you want predictable replica identities. |
| `CACHE_MAX_ENTRIES` | `5000` | Per-cache entry cap. Acts as a secondary guardrail alongside the byte budgets below. |
| `CACHE_CONTRIB_MAX_BYTES` | `16777216` (16 MiB) | Approximate byte budget for cached GitHub contribution payloads + precomputed stats. |
| `CACHE_TEXT_MAX_BYTES` | `67108864` (64 MiB) | Approximate byte budget for cached SVG / JSON / Prometheus text responses. |
| `CACHE_BINARY_MAX_BYTES` | `134217728` (128 MiB) | Approximate byte budget for cached PNG / WebP / AVIF / GIF responses. |
| `RATE_LIMIT_MAX` | `120` | Requests per IP per window. |
| `RATE_LIMIT_TIME_WINDOW_SECONDS` | `60` | Rate-limit window. |
| `CORS_ALLOW_ORIGINS` | `*` | Comma-separated list, `*` for any, **empty string disables CORS**. |
| `CORS_ALLOW_CREDENTIALS` | `false` | CORS credentials flag. |
| `CROSS_ORIGIN_RESOURCE_POLICY` | `cross-origin` | One of `cross-origin` / `same-site` / `same-origin`. The default lets `<img src>` embeds work from any origin. |

### Browser usage / CORS

SVGs are easiest to use via `<img src>` (no preflight, no CORS). For `fetch()` from JS clients (typical of `meta.json`, `themes.json`, `presets.json`, `github-contrib/:user`), CORS is **on by default** — `Access-Control-Allow-Origin: *`, `GET`/`HEAD`/`OPTIONS`, and the following headers are exposed: `X-Cache`, `X-Request-Id`, `Deprecation`, `Sunset`, `Link`, `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, `Retry-After`. Lock down with `CORS_ALLOW_ORIGINS=https://a.example.com,https://b.example.com`, or disable entirely with `CORS_ALLOW_ORIGINS=` (empty).

## Observability

- **Request IDs.** Every response includes `X-Request-Id`; if your proxy/CDN sets one, the API honors it. Every log line carries `reqId`, `method`, `route`, `status`, and `durationMs`.
- **Metrics.** Scrape `GET /v1/metrics` (alias `/metrics`). Series include default Node process metrics (`process_cpu_*`, `nodejs_heap_*`, …) plus:
  - `http_requests_total{method,route,status}`
  - `http_request_duration_seconds` (histogram)
  - `lp_climb_cache_events_total{kind,source}` — `kind` ∈ `contrib|render`, `source` ∈ `hit|stale|miss`
  - `lp_climb_github_fetch_total{result}` — `result` ∈ `success|error`
- **OpenTelemetry (zero-code opt-in).** Add `@opentelemetry/auto-instrumentations-node` to your runtime image and start with `NODE_OPTIONS="--require @opentelemetry/auto-instrumentations-node/register"`. The Fastify + HTTP instrumentations capture routes and propagate trace context automatically.
- **`/metrics` is unauthenticated.** The metrics endpoint does not reveal secrets, but it does expose process health (RSS, event-loop lag, throughput) and cache-hit rates that most operators prefer to keep internal. If you expose the API on the public internet, firewall `/metrics` + `/v1/metrics` to your scrape network — e.g. a Render private service, a Fly internal IPv6, a Cloudflare Access policy, or a reverse-proxy rule that restricts the path to your Prometheus subnet.

## API compatibility & deprecation

The `/v1/...` namespace is the canonical surface. Breaking changes are introduced behind a new URL major (`/v2`, …) with at least a **90-day notice window**, during which the old route keeps responding and emits `Deprecation: true`, `Sunset: <date>`, and `Link: </v…/…>; rel="successor-version"` ([RFC 8594](https://datatracker.ietf.org/doc/html/rfc8594)).

The legacy unversioned routes (`/render.svg`, `/render.png`, `/meta.json`) are already deprecated and **sunset on 2026-12-31**. `/healthz` stays as a permanent alias so external probes don't break.

Full policy + sunset calendar: [`docs/api-compatibility.md`](docs/api-compatibility.md).

## Troubleshooting

- **Demo / preview shows nothing.** Open the generated SVG URL directly. If the response is JSON like `{"error": "...", "message": "..."}`, the API is returning an error (rate-limited, bad token, invalid username). The `error` code tells you which.
- **`GET /` returns 404.** That's expected — the root is not served. Use `/v1/healthz` for liveness or `/docs` for the UI.
- **Embedding into a third-party site is blocked.** Make sure the response includes `Cross-Origin-Resource-Policy: cross-origin` (it does by default). If you set `CROSS_ORIGIN_RESOURCE_POLICY=same-origin`, only the same origin can `<img src>` the response.
- **`vs` / `team` look like they're being ignored.** They are — in **`card`** style. Add `&style=ladder`.
- **GIF takes forever.** Each frame is a full SVG → raster pass. Lower `frames` / `fps`, shrink dimensions, or cache the response.
- **Theme looks "transparent" on some backgrounds.** Every built-in theme has an explicit `bg`. If you've overridden it, set one yourself: `&bg=%23000000`.

## Project layout & contributing

```text
packages/
  api/             Fastify HTTP server. /v1/* routes, swagger UI, SWR LRU, rate limit.
  action/          GitHub Action runtime (Docker). Renders SVG/PNG to disk.
  core/            Pure stats: contribution → LP timeline, tier mapping, deltas.
  demo/            Static demo site (HTML/CSS/JS) + a tiny dev proxy server.
  github-contrib/  GitHub GraphQL fetch → normalized cells. Typed errors.
  svg-creator/     Card / ladder SVG renderer + raster encoders (resvg, sharp, gifenc).
  themes/          Theme catalog + getTheme/listThemes.
  types/           Shared TypeScript types.

docs/              api-compatibility.md, design.md, prod.md, theme-previews/*.svg
scripts/           generate-theme-previews.mjs, pin-action-image.mjs
.github/workflows/ ci.yml, pages.yml, release.yml, nightly.yml, manual-run.yml,
                   publish-api-image.yml, publish-action-image.yml
```

### Common scripts

```bash
# Build everything
npm run build:npm                         # or: bun run build

# Run the API in dev (watch mode)
bun run dev                                # or: npm run dev:npm

# Run all package tests (core stats/LP, API cache + coalescer, Action parser, SVG snapshots)
npm test                                   # vitest across packages/{core,svg-creator,api,action}
npm --workspace packages/svg-creator test -- -u  # update SVG snapshots only

# Lint the API package (eslint v9 flat config; only @lp-climb/api has lint wired up)
npm run lint:npm                           # or: bun run lint

# Regenerate docs/theme-previews/*.svg
npm run theme-previews

# Format
npm run format:npm                         # or: bun run format
```

### Releasing

Tag a release on `main` (`git tag v0.1.0 && git push origin v0.1.0`) to trigger `.github/workflows/release.yml`, which builds + pushes the API and Action images to GHCR, pins the Action digest into `action.yml`, and creates a GitHub Release. Detailed checklist: [`docs/prod.md`](docs/prod.md).

---

License: [MIT](./LICENSE) — © Skpow1234 and contributors.
