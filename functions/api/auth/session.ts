import { handleGetSession } from '../../../packages/api/src/handlers/auth-session'
import type { AuthEnv } from '../../../packages/api/src/auth/config'
import { applyCorsHeaders, buildCorsHeaders } from '../../../packages/api/src/cors'

interface Context {
  request: Request
  env: AuthEnv
}

const CORS_METHODS = 'GET, OPTIONS'

export async function onRequest(context: Context): Promise<Response> {
  const { request, env } = context
  const corsHeaders = buildCorsHeaders(request, CORS_METHODS)

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (request.method === 'GET') {
    return applyCorsHeaders(await handleGetSession(request, env), corsHeaders)
  }

  return applyCorsHeaders(new Response('Method Not Allowed', { status: 405 }), corsHeaders)
}
