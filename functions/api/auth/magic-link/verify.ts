import { handleMagicLinkVerify } from '../../../../packages/api/src/handlers/auth-magic-link-verify'
import type { AuthEnv } from '../../../../packages/api/src/auth/config'

interface Context {
  request: Request
  env: AuthEnv
}

/**
 * The verify endpoint is a top-level GET navigation (the player clicks the
 * link in their email), not an XHR — it responds with a 302 redirect that
 * carries the session `Set-Cookie`. No CORS headers: there is no cross-origin
 * fetch here, the browser simply follows the redirect.
 */
export async function onRequest(context: Context): Promise<Response> {
  const { request, env } = context
  if (request.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 })
  }
  return handleMagicLinkVerify(request, env)
}
