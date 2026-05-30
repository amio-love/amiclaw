/**
 * Pure URL-mapping helpers for the legacy-host 301 redirect.
 *
 * The Cloudflare Pages catch-all middleware at `functions/_middleware.ts`
 * intercepts requests whose Host header is `bombsquad.amio.fans` and
 * rewrites them to their `claw.amio.fans` canonical equivalents. The
 * mapping rules live here as pure functions so the redirect contract is
 * unit-testable in the Node vitest environment without spinning up a
 * Workers runtime.
 *
 * Mapping:
 *   `/`                          → `/bombsquad`
 *   `/game`                      → `/bombsquad`
 *   `/game/connect`              → `/bombsquad/connect`
 *   `/game/run`                  → `/bombsquad/run`
 *   `/result`                    → `/bombsquad/result`
 *   `/compatibility`             → `/bombsquad/compatibility`
 *   `/manual/...`                → `/manual/...`  (same path on new host)
 *   `/api/...`                   → `/api/...`     (same path on new host)
 *   anything else                → same path on new host (no rewrite)
 *
 * Query string is preserved verbatim on every branch.
 */

export const LEGACY_HOST = 'bombsquad.amio.fans'
export const CANONICAL_HOST = 'claw.amio.fans'

/**
 * Build the canonical absolute URL a legacy-host request should be
 * redirected to. `pathname` and `search` come straight from
 * `new URL(request.url)`; `search` already starts with `?` when present
 * and is empty otherwise.
 */
export function mapLegacyBombsquadPath(pathname: string, search: string): string {
  const newPath = rewritePath(pathname)
  return `https://${CANONICAL_HOST}${newPath}${search}`
}

function rewritePath(pathname: string): string {
  // Root → BombSquad landing on the new platform.
  if (pathname === '/' || pathname === '') return '/bombsquad'

  // Legacy BombSquad SPA routes — prefix with /bombsquad.
  if (pathname === '/game') return '/bombsquad'
  if (pathname === '/game/connect') return '/bombsquad/connect'
  if (pathname === '/game/run') return '/bombsquad/run'
  if (pathname === '/result') return '/bombsquad/result'
  if (pathname === '/compatibility') return '/bombsquad/compatibility'

  // Same-path passthroughs — `/manual/*`, `/api/*`, and any other path
  // not in the rewrite table go to the same path on the canonical host.
  return pathname
}
