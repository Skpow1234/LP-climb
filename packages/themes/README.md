# @lp-climb/themes

Theme presets for LP Climb.

## Themes

- `rift` (default)
- `assassin`
- `mage`
- `tank`
- `support`
- `marksman`
- `mono`

## Theme catalog

In the API:

- `GET /v1/themes.json`

## Usage

In the API:

- `GET /v1/render.svg?user=USER&theme=rift`

In the GitHub Action `outputs` option:

```text
dist/lp.svg?theme=rift
dist/lp-assassin.svg?theme=assassin
```

## Custom theme params (optional)

You can override colors directly via query params:

```text
/v1/render.svg?user=octocat&theme=rift&accent=%23ff00aa&bg=%23000000
```

Tier color overrides:

```text
/v1/render.svg?user=octocat&theme=rift&tier_challenger=%23ffd36b
```

## Preview gallery

See `docs/theme-previews/` at the repo root.

