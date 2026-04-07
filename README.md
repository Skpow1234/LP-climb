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

Then open:

- `http://localhost:3000/render.svg?user=octocat&theme=rift`
- `http://localhost:3000/render.svg?user=octocat&vs=torvalds&theme=assassin`

## Docker

```bash
cp .env.example .env
docker compose up --build
```

## Themes

`theme` supports:

- `rift` (default)
- `assassin`, `mage`, `tank`, `support`, `marksman`
- `mono`
