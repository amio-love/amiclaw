import { handleGoogleCallback } from '../../../../packages/api/src/handlers/auth-google-callback'
import { createGoogleTokenExchanger } from '../../../../packages/api/src/auth/google-oauth'
import type { AuthEnv } from '../../../../packages/api/src/auth/config'

interface Context {
  request: Request
  env: AuthEnv
}

/**
 * The callback endpoint is a top-level GET navigation (Google redirects the
 * browser back here after consent), not an XHR — it responds with a 302 that
 * carries the session `Set-Cookie`. No CORS headers: the browser follows the
 * redirect. The real Google-backed token exchanger is built from the env here;
 * the pure handler takes it as an argument so tests inject a mock.
 */
export async function onRequest(context: Context): Promise<Response> {
  const { request, env } = context
  if (request.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 })
  }
  return handleGoogleCallback(request, env, createGoogleTokenExchanger(env))
}
