# LP Climb (Ranked Ladder SVG)

Dockerized service that renders a League-inspired **ranked climb ladder** animation using **GitHub contribution data**.

## Endpoints

- `GET /render.svg?user=USER&theme=rift`
  - Optional: `&vs=OTHER_USER` for 1v1 comparison
  - Optional: `&width=900&height=260`
- `GET /meta.json?user=USER`
  - Optional: `&vs=OTHER_USER`
- `GET /healthz`

## Local dev

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

## Demo playground

Start the API first, then the demo:

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

## GitHub Action

This repo includes a Docker-based action. Locally in this repository, workflows can use:

- `uses: ./`

### Example workflow snippet

```yaml
- uses: ./
  with:
    github_user_name: ${{ github.repository_owner }}
    outputs: |
      dist/lp.svg?theme=rift
      dist/lp-vs.svg?theme=rift&vs=torvalds
```

### Publishing (prod)

To make pipelines “real” (pinned, reproducible), publish images to GHCR:

- Run workflow `publish-action-image` to push the action image.
  - It prints a pinned reference like:
    - `docker://ghcr.io/OWNER/REPO-action@sha256:...`
  - It also **commits the pin** back into `action.yml`.
- Run workflow `publish-api-image` to push the API service image.

Then deploy the API image anywhere that can run a container (VM, Fly.io, Render, Railway, Kubernetes).

## Themes

`theme` supports:

- `rift` (default)
- `assassin`, `mage`, `tank`, `support`, `marksman`
- `mono`

### Theme previews

Run:

```bash
npm run theme-previews
```

Outputs are written to `docs/theme-previews/*.svg`.
