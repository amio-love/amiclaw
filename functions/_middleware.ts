import {
  LEGACY_HOST,
  ORACLE_HOST,
  mapLegacyBombsquadPath,
  mapLegacyOraclePath,
} from '../packages/api/src/handlers/middleware-host-redirect'

/**
 * Cloudflare Pages Function catch-all middleware — `_middleware.ts` runs
 * BEFORE any matched route handler under `functions/` and ahead of the
 * static SPA assets. We use it to 301-redirect each game's per-game vanity
 * host to its `claw.amio.fans` canonical equivalent: `bombsquad.amio.fans`
 * → `claw.amio.fans/bombsquad`, `oracle.amio.fans` → `claw.amio.fans/oracle`.
 * Any other host (the new canonical `claw.amio.fans`, preview deployments
 * on `*.amiclaw.pages.dev`, localhost) falls through via `context.next()`.
 *
 * The per-host URL-mapping rules live in
 * `packages/api/src/handlers/middleware-host-redirect.ts` as pure helpers,
 * so each redirect contract is unit-testable without spinning up a Workers
 * runtime. To add another game's vanity host, register its mapper below.
 */

interface Context {
  request: Request
  next: () => Promise<Response>
}

/**
 * Vanity host → pure path-mapper dispatch table. Each mapper takes the
 * inbound `(pathname, search)` and returns the canonical absolute URL on
 * `claw.amio.fans`. A host absent from this table falls through to the
 * downstream handler / static assets.
 */
const VANITY_HOST_MAPPERS: Record<string, (pathname: string, search: string) => string> = {
  [LEGACY_HOST]: mapLegacyBombsquadPath,
  [ORACLE_HOST]: mapLegacyOraclePath,
}

export async function onRequest(context: Context): Promise<Response> {
  const { request, next } = context
  const url = new URL(request.url)
  // Cloudflare populates `url.host` from the request's Host header; fall
  // back to the explicit Host header for the rare runtime where the URL
  // already carries the worker host instead of the inbound host.
  const inboundHost = url.host || request.headers.get('host') || ''

  const mapper = VANITY_HOST_MAPPERS[inboundHost]
  if (mapper) {
    const target = mapper(url.pathname, url.search)
    return Response.redirect(target, 301)
  }

  return next()
}
