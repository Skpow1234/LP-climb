/**
 * OpenAPI / Swagger schema fragments for the LP Climb API.
 *
 * Why hand-written instead of auto-generated from Zod?
 * - Zod v4 is strict about runtime inputs (coerce, refinements, pipes). The
 *   equivalent JSON Schema needed for documentation is much smaller — the
 *   goal here is a readable API catalog, not a redundant second validator.
 * - We explicitly disable Fastify's built-in validator (see `server.ts`)
 *   so these schemas don't short-circuit requests; Zod remains the single
 *   source of truth for runtime parsing.
 *
 * Adding a new route? Mirror one of the existing schemas below: the minimum
 * useful shape is `{ tags, summary, description, querystring, response }`.
 */
import { PRESET_IDS } from "./presets.js";

// Themes mirror `packages/themes/src/index.ts`. Kept as a hard-coded list so
// the OpenAPI spec does not need an async init step — Swagger UI renders this
// as a dropdown in the "Try it out" panel.
const THEME_IDS = [
  "rift",
  "assassin",
  "mage",
  "tank",
  "support",
  "marksman",
  "mono"
] as const;

const COLOR_SCHEMA = {
  type: "string",
  description: "Hex (#RRGGBB / #RRGGBBAA / #RGB) or `rgb()` / `rgba()` string.",
  example: "#2AE98C"
} as const;

const GITHUB_LOGIN_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: 39,
  pattern: "^(?!-)(?!.*--)[a-zA-Z0-9-]{1,39}(?<!-)$",
  description: "GitHub username (1–39 chars, no leading/trailing/double hyphens).",
  example: "octocat"
} as const;

const RENDER_COMMON_PROPS = {
  user: GITHUB_LOGIN_SCHEMA,
  vs: {
    ...GITHUB_LOGIN_SCHEMA,
    description:
      "Compare mode: a second GitHub login rendered on the same ladder. Mutually exclusive with `team`. Only meaningful when `style=ladder` (silently ignored in card mode)."
  },
  team: {
    type: "string",
    description:
      "Team mode: comma-separated list of up to 5 extra GitHub logins drawn on the same ladder. Mutually exclusive with `vs`. Only meaningful when `style=ladder`.",
    example: "torvalds,gaearon,sindresorhus"
  },
  theme: {
    type: "string",
    enum: THEME_IDS,
    default: "rift",
    description: "Preset color scheme. See `GET /v1/themes.json` for the live catalog."
  },
  preset: {
    type: "string",
    enum: PRESET_IDS,
    description:
      "Named dimension preset (e.g. `readme`, `banner`). Explicit `width` / `height` override the preset."
  },
  width: {
    type: "integer",
    minimum: 500,
    maximum: 2000,
    description: "Output width in pixels. Overrides `preset` if both are set."
  },
  height: {
    type: "integer",
    minimum: 180,
    maximum: 900,
    description: "Output height in pixels. Overrides `preset` if both are set."
  },
  style: {
    type: "string",
    enum: ["card", "ladder"],
    default: "card",
    description:
      "Visualization style. `card` renders the GitHub-style tier card (primary user only). `ladder` renders the horizontal climb ladder and is required for `vs` / `team` modes."
  },
  // Theme overrides ("champion select") — every color is optional; when set,
  // replaces the matching key in the base theme.
  bg: COLOR_SCHEMA,
  frame: COLOR_SCHEMA,
  text: COLOR_SCHEMA,
  accent: COLOR_SCHEMA,
  glow: COLOR_SCHEMA,
  tier_iron: COLOR_SCHEMA,
  tier_bronze: COLOR_SCHEMA,
  tier_silver: COLOR_SCHEMA,
  tier_gold: COLOR_SCHEMA,
  tier_plat: COLOR_SCHEMA,
  tier_emerald: COLOR_SCHEMA,
  tier_diamond: COLOR_SCHEMA,
  tier_master: COLOR_SCHEMA,
  tier_grandmaster: COLOR_SCHEMA,
  tier_challenger: COLOR_SCHEMA
} as const;

const ERROR_RESPONSE_SCHEMA = {
  type: "object",
  required: ["error", "message"],
  properties: {
    error: { type: "string", example: "bad_request" },
    message: { type: "string", example: "invalid github username" }
  }
} as const;

// Response schemas are mostly structural; we don't pin every byte of the
// computed stats / render output because the formats are documented in their
// content types (image/*) and the stats shape is already tested in core.
const META_RESPONSE_SCHEMA = {
  type: "object",
  description: "Computed LP / contribution stats for the primary user and optional compare/team set.",
  additionalProperties: true
} as const;

function renderSchema(opts: {
  tags: string[];
  summary: string;
  description: string;
  produces: string;
  extraProps?: Record<string, unknown>;
  deprecated?: boolean;
  responseContentType?: string;
}) {
  return {
    tags: opts.tags,
    summary: opts.summary,
    description: opts.description,
    ...(opts.deprecated ? { deprecated: true } : {}),
    querystring: {
      type: "object",
      required: ["user"],
      properties: { ...RENDER_COMMON_PROPS, ...(opts.extraProps ?? {}) },
      additionalProperties: false
    },
    response: {
      200: {
        description: `Rendered ${opts.produces}.`,
        // `@fastify/swagger` understands the `content` shortcut for non-JSON
        // responses; Swagger UI renders it as the "Media type" picker.
        content: {
          [opts.responseContentType ?? opts.produces]: {
            schema: { type: "string", format: "binary" }
          }
        }
      },
      400: {
        description: "Invalid query (Zod validation or `vs` + `team` conflict).",
        content: { "application/json": { schema: ERROR_RESPONSE_SCHEMA } }
      },
      429: {
        description: "Rate limited. Inspect `Retry-After` / `RateLimit-*` headers.",
        content: { "application/json": { schema: ERROR_RESPONSE_SCHEMA } }
      },
      502: {
        description: "Upstream GitHub fetch failed (e.g. unknown user, rate limit).",
        content: { "application/json": { schema: ERROR_RESPONSE_SCHEMA } }
      }
    }
  };
}

export const SCHEMAS = {
  renderSvg: renderSchema({
    tags: ["Render"],
    summary: "Render as SVG",
    description:
      "Returns a cached / freshly-rendered SVG of the ranked climb card or ladder. Safe to embed via `<img src>` from any origin (see `Cross-Origin-Resource-Policy`).",
    produces: "image/svg+xml"
  }),
  renderPng: renderSchema({
    tags: ["Render"],
    summary: "Render as PNG",
    description:
      "Rasterizes the SVG output via resvg. Marker / animation are baked at the current-LP position (no CSS-animation in PNG output).",
    produces: "image/png"
  }),
  renderWebp: renderSchema({
    tags: ["Render"],
    summary: "Render as WebP",
    description:
      "Rasterizes via resvg then encodes with `sharp`. Default `quality=82` — small and readable for profile READMEs.",
    produces: "image/webp",
    extraProps: {
      quality: {
        type: "integer",
        minimum: 1,
        maximum: 100,
        default: 82,
        description: "WebP encoder quality."
      }
    }
  }),
  renderAvif: renderSchema({
    tags: ["Render"],
    summary: "Render as AVIF",
    description:
      "Rasterizes via resvg then encodes with `sharp`. Smaller than WebP at equivalent quality but meaningfully slower to encode — cache aggressively.",
    produces: "image/avif",
    extraProps: {
      quality: {
        type: "integer",
        minimum: 1,
        maximum: 100,
        default: 55,
        description: "AVIF encoder quality."
      }
    }
  }),
  renderGif: renderSchema({
    tags: ["Render"],
    summary: "Render as animated GIF",
    description:
      "Renders N frames (default 24) at F FPS (default 12). Each frame is a full SVG→raster pass — expensive; keep dimensions modest.",
    produces: "image/gif",
    extraProps: {
      frames: {
        type: "integer",
        minimum: 6,
        maximum: 60,
        default: 24,
        description: "Number of frames to sample across the LP timeline."
      },
      fps: {
        type: "integer",
        minimum: 4,
        maximum: 30,
        default: 12,
        description: "Playback rate."
      }
    }
  }),
  metaJson: {
    tags: ["Meta"],
    summary: "Computed LP / contribution stats",
    description:
      "Machine-readable JSON version of what the card / ladder visualizes: total contributions, streaks, per-member stats, etc. Shares the SWR LRU with the render endpoints.",
    querystring: {
      type: "object",
      required: ["user"],
      properties: {
        user: GITHUB_LOGIN_SCHEMA,
        vs: RENDER_COMMON_PROPS.vs,
        team: RENDER_COMMON_PROPS.team
      },
      additionalProperties: false
    },
    response: {
      200: {
        description: "Stats payload.",
        content: { "application/json": { schema: META_RESPONSE_SCHEMA } }
      },
      400: { content: { "application/json": { schema: ERROR_RESPONSE_SCHEMA } } },
      429: { content: { "application/json": { schema: ERROR_RESPONSE_SCHEMA } } },
      502: { content: { "application/json": { schema: ERROR_RESPONSE_SCHEMA } } }
    }
  },
  githubContrib: {
    tags: ["Meta"],
    summary: "Normalized contribution calendar",
    description:
      "Edge-friendly proxy that returns the normalized `{ x, y, date, count, level }` cells for a user. Shares the contrib SWR LRU with the render endpoints (so a call here warms render cache and vice versa).",
    params: {
      type: "object",
      required: ["user"],
      properties: { user: GITHUB_LOGIN_SCHEMA }
    }
  },
  themes: {
    tags: ["Catalog"],
    summary: "Theme catalog",
    description: "All preset themes with their colors. Useful for building theme pickers."
  },
  presets: {
    tags: ["Catalog"],
    summary: "Dimension preset catalog",
    description: "Named `width × height` presets (readme, banner, badge, …)."
  },
  healthz: {
    tags: ["Ops"],
    summary: "Liveness probe",
    description: "Always-200 health check. No external deps touched."
  },
  metrics: {
    tags: ["Ops"],
    summary: "Prometheus metrics",
    description:
      "Text-format exposition. Includes default Node process metrics plus `http_requests_total`, `http_request_duration_seconds`, `lp_climb_cache_events_total{kind,source}`, `lp_climb_github_fetch_total{result}`."
  }
} as const;

export const OPENAPI_INFO = {
  title: "LP Climb API",
  version: "1.0.0",
  description:
    "Public, read-only API that turns a GitHub user's contribution calendar into a ranked-climb card (or horizontal ladder) as SVG / PNG / WebP / AVIF / GIF.\n\n" +
    "**Endpoints are safe to embed cross-origin** (e.g. profile READMEs, github.io demos) — `Cross-Origin-Resource-Policy: cross-origin` is set on every render / meta response.\n\n" +
    "Rate-limited per IP (see `RateLimit-*` headers on every response). See [the GitHub repo](https://github.com/Skpow1234/LP-climb) for deeper docs.",
  contact: {
    name: "LP Climb on GitHub",
    url: "https://github.com/Skpow1234/LP-climb"
  },
  license: {
    name: "MIT",
    url: "https://github.com/Skpow1234/LP-climb/blob/main/LICENSE"
  }
} as const;

export const OPENAPI_TAGS = [
  { name: "Render", description: "Image endpoints (SVG / PNG / WebP / AVIF / GIF)." },
  { name: "Meta", description: "JSON stats and raw contribution data." },
  { name: "Catalog", description: "Discoverability: themes and dimension presets." },
  { name: "Ops", description: "Liveness and Prometheus metrics." }
] as const;
