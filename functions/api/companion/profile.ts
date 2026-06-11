import {
  handleDeleteProfile,
  handleGetProfile,
  handlePutProfileSettings,
} from '../../../packages/api/src/handlers/companion-profile'
import type { CompanionApiEnv } from '../../../packages/api/src/handlers/companion-shared'
import { applyCorsHeaders, buildCorsHeaders } from '../../../packages/api/src/cors'

interface Context {
  request: Request
  env: CompanionApiEnv
}

const CORS_METHODS = 'GET, PUT, DELETE, OPTIONS'

export async function onRequest(context: Context): Promise<Response> {
  const { request, env } = context
  const corsHeaders = buildCorsHeaders(request, CORS_METHODS)

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (request.method === 'GET') {
    return applyCorsHeaders(await handleGetProfile(request, env), corsHeaders)
  }

  if (request.method === 'PUT') {
    return applyCorsHeaders(await handlePutProfileSettings(request, env), corsHeaders)
  }

  if (request.method === 'DELETE') {
    return applyCorsHeaders(await handleDeleteProfile(request, env), corsHeaders)
  }

  return applyCorsHeaders(new Response('Method Not Allowed', { status: 405 }), corsHeaders)
}
