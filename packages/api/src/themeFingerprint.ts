/**
 * Stable cache-key fragment for a theme *after* query-string overrides have
 * been applied. The renderer reads `bg`, `frame`, `text`, `accent`, `glow`,
 * and the full `tier.*` palette, so any of those changing must produce a
 * different cache entry — otherwise a request with `accent=%23ff0000` would
 * happily return a previously-cached green image for the same user/theme/dims.
 *
 * `name` is intentionally excluded — it's display-only (not read by the
 * renderer) and including it would pointlessly couple the key to rename
 * refactors in the themes package.
 */
export function themeFingerprint(theme: any): string {
  return JSON.stringify({
    id: theme.id,
    bg: theme.bg,
    frame: theme.frame,
    text: theme.text,
    accent: theme.accent,
    glow: theme.glow,
    tier: theme.tier
  });
}
