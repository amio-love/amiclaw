import {
  handleGetProxySocial,
  handlePutProxySocial,
} from '../../../packages/api/src/handlers/companion-proxy-social-settings'
import type { CompanionApiEnv } from '../../../packages/api/src/handlers/companion-shared'
import { applyCorsHeaders, buildCorsHeaders } from '../../../packages/api/src/cors'

interface Context {
  request: Request
  env: CompanionApiEnv
}

const CORS_METHODS = 'GET, PUT, OPTIONS'

export async function onRequest(context: Context): Promise<Response> {
  const { request, env } = context
  const corsHeaders = buildCorsHeaders(request, CORS_METHODS)

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (request.method === 'GET') {
    return applyCorsHeaders(await handleGetProxySocial(request, env), corsHeaders)
  }

  if (request.method === 'PUT') {
    return applyCorsHeaders(await handlePutProxySocial(request, env), corsHeaders)
  }

  return applyCorsHeaders(new Response('Method Not Allowed', { status: 405 }), corsHeaders)
}
