import { handleGoogleStart } from '../../../../packages/api/src/handlers/auth-google-start'
import type { AuthEnv } from '../../../../packages/api/src/auth/config'

interface Context {
  request: Request
  env: AuthEnv
}

/**
 * The start endpoint is a top-level GET navigation (the player clicks the Google
 * button), not an XHR — it responds with a 302 redirect to Google's consent
 * screen. No CORS headers: there is no cross-origin fetch here.
 */
export async function onRequest(context: Context): Promise<Response> {
  const { request, env } = context
  if (request.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 })
  }
  return handleGoogleStart(env)
}
