/**
 * Pure CORS origin-allowlist helpers shared by the `functions/api/*` thin
 * entry adapters (`leaderboard.ts`, `events.ts`, `dashboard.ts`).
 *
 * The entries each used to hardcode a single-origin
 * `Access-Control-Allow-Origin: https://claw.amio.fans`. That blocked preview
 * deployments — which serve the SPA on `*.amiclaw.pages.dev` but point
 * `VITE_API_BASE` at the production canonical (see `shared/leaderboard-api.ts`)
 * — from submitting cross-origin. These helpers resolve the request `Origin`
 * against a small allowlist (production canonical + this project's preview
 * subdomains) and echo it back when it matches, falling back to the canonical
 * origin otherwise (deny-by-default).
 *
 * Kept as pure functions with a co-located vitest so the allowlist contract is
 * unit-tested in the Node environment without a Workers runtime — mirroring
 * `validation.ts` and `handlers/middleware-host-redirect.ts`.
 */

// Single source for the canonical origin + the preview-host suffix. The
// canonical origin doubles as the deny-by-default fallback for any Origin that
// is unknown, malformed, or absent.
const CANONICAL_ORIGIN = 'https://claw.amio.fans'
const CANONICAL_HOSTNAME = 'claw.amio.fans'
const PREVIEW_HOSTNAME_SUFFIX = '.amiclaw.pages.dev'

/**
 * Resolve the value for the `Access-Control-Allow-Origin` header.
 *
 * Returns the request's own `Origin` when it is allowed, otherwise the
 * production canonical origin. An unknown, malformed, or missing `Origin`
 * therefore gets the canonical value, so production same-origin behaviour is
 * unchanged and deny-by-default holds (a disallowed origin never sees itself
 * reflected).
 */
export function resolveCorsOrigin(request: Request): string {
  const origin = request.headers.get('Origin')
  if (origin && isAllowedOrigin(origin)) return origin
  return CANONICAL_ORIGIN
}

/**
 * Allowlist predicate. Parses the `Origin` with the URL API and matches on the
 * structured `hostname` + `protocol` — never a substring of the raw `Origin`
 * string — so subdomain-spoofing attempts are rejected:
 *   - `https://evil-amiclaw.pages.dev`        (no dot before the suffix)
 *   - `https://x.amiclaw.pages.dev.evil.com`  (suffix not at the end)
 *   - `http://x.amiclaw.pages.dev`            (not https)
 * A malformed `Origin` throws in `new URL(...)` and is treated as not allowed.
 *
 * Only `*.amiclaw.pages.dev` subdomains are allowed — the bare apex
 * `amiclaw.pages.dev` is intentionally excluded (the `.`-prefixed suffix check
 * does not match it), keeping the allowlist to the production canonical plus
 * preview subdomains exactly as scoped.
 */
function isAllowedOrigin(origin: string): boolean {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  const { hostname } = url
  return hostname === CANONICAL_HOSTNAME || hostname.endsWith(PREVIEW_HOSTNAME_SUFFIX)
}

/**
 * Build the CORS response headers for an entry's responses.
 *
 * `methods` is the entry-specific `Access-Control-Allow-Methods` string (e.g.
 * `'GET, POST, OPTIONS'`), passed in so each thin entry keeps its own method
 * set. `Vary: Origin` is always set because `Access-Control-Allow-Origin`
 * varies per request `Origin` — without it a CDN / browser cache could serve
 * one origin's response to another.
 */
export function buildCorsHeaders(request: Request, methods: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': resolveCorsOrigin(request),
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  }
}

/**
 * Return a copy of `response` with the CORS headers applied.
 *
 * `Response` headers are immutable once the body has been consumed by a
 * handler, so the body is re-wrapped (`new Response(response.body, response)`)
 * to obtain a fresh, mutable header set before each CORS header is `set`.
 * Shared by the `functions/api/*` thin entries for their GET / POST / 405
 * responses (the OPTIONS preflight builds its headers directly).
 */
export function applyCorsHeaders(
  response: Response,
  corsHeaders: Record<string, string>
): Response {
  const nextResponse = new Response(response.body, response)
  for (const [key, value] of Object.entries(corsHeaders)) {
    nextResponse.headers.set(key, value)
  }
  return nextResponse
}
