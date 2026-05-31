/**
 * Pure URL-mapping helpers for the per-game vanity-host 301 redirects.
 *
 * The Cloudflare Pages catch-all middleware at `functions/_middleware.ts`
 * intercepts requests whose Host header is a per-game vanity domain
 * (`bombsquad.amio.fans`, `oracle.amio.fans`) and rewrites them to their
 * `claw.amio.fans` canonical equivalents. The mapping rules live here as
 * pure functions so each redirect contract is unit-testable in the Node
 * vitest environment without spinning up a Workers runtime.
 *
 * BombSquad mapping (`bombsquad.amio.fans` → `claw.amio.fans`):
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
 * Yijing Oracle mapping (`oracle.amio.fans` → `claw.amio.fans`):
 *   `/`                          → `/oracle`
 *   `/manual/...`                → `/manual/...`  (same path — shared platform manual)
 *   `/api/...`                   → `/api/...`     (same path — shared platform API)
 *   anything else `/<x>`         → `/oracle/<x>`  (prefix /oracle — the SPA lives under /oracle/*)
 *
 * Query string is preserved verbatim on every branch.
 */

export const LEGACY_HOST = 'bombsquad.amio.fans'
export const ORACLE_HOST = 'oracle.amio.fans'
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

/**
 * Build the canonical absolute URL an `oracle.amio.fans` request should be
 * redirected to. `pathname` and `search` come straight from
 * `new URL(request.url)`; `search` already starts with `?` when present
 * and is empty otherwise.
 *
 * Unlike BombSquad — which passes unknown paths through verbatim — the
 * Yijing Oracle SPA lives entirely under `/oracle/*`, so any path outside
 * the shared `/manual/*` and `/api/*` namespaces is prefixed with
 * `/oracle` (e.g. a vanity deep link `/casting` → `/oracle/casting`).
 */
export function mapLegacyOraclePath(pathname: string, search: string): string {
  // Root → Yijing Oracle landing on the new platform.
  if (pathname === '/' || pathname === '') return `https://${CANONICAL_HOST}/oracle${search}`

  // Shared platform namespaces — `/manual/*` and `/api/*` are not
  // game-specific, so they pass through to the same path verbatim.
  if (pathname === '/manual' || pathname.startsWith('/manual/')) {
    return `https://${CANONICAL_HOST}${pathname}${search}`
  }
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    return `https://${CANONICAL_HOST}${pathname}${search}`
  }

  // Everything else is an Oracle SPA route — prefix with /oracle.
  return `https://${CANONICAL_HOST}/oracle${pathname}${search}`
}
