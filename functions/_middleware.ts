import {
  LEGACY_HOST,
  mapLegacyBombsquadPath,
} from '../packages/api/src/handlers/middleware-host-redirect'

/**
 * Cloudflare Pages Function catch-all middleware — `_middleware.ts` runs
 * BEFORE any matched route handler under `functions/` and ahead of the
 * static SPA assets. We use it to 301-redirect the legacy
 * `bombsquad.amio.fans` host to its `claw.amio.fans/bombsquad` canonical
 * equivalent. Any other host (the new canonical `claw.amio.fans`,
 * preview deployments on `*.amiclaw.pages.dev`, localhost) falls through
 * via `context.next()`.
 *
 * The URL-mapping rules live in
 * `packages/api/src/handlers/middleware-host-redirect.ts` as a pure
 * helper, so the redirect contract is unit-testable without spinning up
 * a Workers runtime.
 */

interface Context {
  request: Request
  next: () => Promise<Response>
}

export async function onRequest(context: Context): Promise<Response> {
  const { request, next } = context
  const url = new URL(request.url)
  // Cloudflare populates `url.host` from the request's Host header; fall
  // back to the explicit Host header for the rare runtime where the URL
  // already carries the worker host instead of the inbound host.
  const inboundHost = url.host || request.headers.get('host') || ''

  if (inboundHost === LEGACY_HOST) {
    const target = mapLegacyBombsquadPath(url.pathname, url.search)
    return Response.redirect(target, 301)
  }

  return next()
}
