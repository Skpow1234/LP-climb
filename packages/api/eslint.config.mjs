// ESLint v9 flat config for @lp-climb/api.
//
// Scope: lints only the TypeScript sources under `src/` — `dist/` and any
// generated output are ignored. We pull in the recommended rule sets from
// `@eslint/js` and `typescript-eslint` and turn on `strict` (no type-aware
// rules — those would require a separate `parserOptions.project` pass and
// roughly 5× the runtime; not worth it for a service this size).
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**"]
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        // Node globals used in src/ (process.env, console, setTimeout, ...).
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        fetch: "readonly"
      }
    },
    rules: {
      // The Fastify request/reply objects are typed as `any` in the route
      // handlers (the project intentionally keeps the runtime contract in
      // Zod, not in Fastify's generic plumbing). Allow that explicitly.
      "@typescript-eslint/no-explicit-any": "off",
      // Same reason — we cast to `any` in a few places to read Fastify
      // internals (e.g. `req.routeOptions.url`).
      "@typescript-eslint/no-unsafe-function-type": "off",
      // Allow `_`-prefixed unused args (matches the codebase's convention).
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }
      ],
      // The project sets `noUncheckedIndexedAccess: true`, so `array[i]` is
      // typed as `T | undefined`. `!` is the documented escape hatch when
      // we've already validated the index (e.g. inside a `.map((_, i) => …)`
      // body where `i` is known to be in range). Banning it forces verbose
      // and harder-to-read defensive code with no real safety win.
      "@typescript-eslint/no-non-null-assertion": "off"
    }
  }
];
