import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default("0.0.0.0"),
  GITHUB_TOKEN: z.string().min(1),
  CACHE_TTL_SECONDS: z.coerce.number().int().min(10).max(86400).default(21600),
  CACHE_STALE_SECONDS: z.coerce.number().int().min(0).max(604800).default(86400),
  CACHE_MAX_ENTRIES: z.coerce.number().int().min(100).max(50000).default(5000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10000).default(120),
  RATE_LIMIT_TIME_WINDOW_SECONDS: z.coerce.number().int().min(1).max(3600).default(60),
  // CORS: comma-separated allow-list of origins. `*` (the default) reflects
  // any origin, which is the right call for a public read-only image API.
  // Example: `CORS_ALLOW_ORIGINS=https://example.com,https://app.example.com`.
  // Set to an empty string to disable CORS entirely (no Access-Control-* headers).
  CORS_ALLOW_ORIGINS: z.string().default("*"),
  CORS_ALLOW_CREDENTIALS: z
    .union([z.boolean(), z.string()])
    .transform((v) => (typeof v === "string" ? v === "true" : v))
    .default(false)
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(env: NodeJS.ProcessEnv = process.env): Env {
  return EnvSchema.parse(env);
}

