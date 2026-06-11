import { handleMemoryDelete } from '../../../../packages/api/src/handlers/companion-memories'
import type { CompanionApiEnv } from '../../../../packages/api/src/handlers/companion-shared'
import { applyCorsHeaders, buildCorsHeaders } from '../../../../packages/api/src/cors'

interface Context {
  request: Request
  env: CompanionApiEnv
  params: { id?: string }
}

const CORS_METHODS = 'DELETE, OPTIONS'

export async function onRequest(context: Context): Promise<Response> {
  const { request, env, params } = context
  const corsHeaders = buildCorsHeaders(request, CORS_METHODS)

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  const episodeId = params.id
  if (typeof episodeId !== 'string' || episodeId.length === 0) {
    return applyCorsHeaders(new Response('Not Found', { status: 404 }), corsHeaders)
  }

  if (request.method === 'DELETE') {
    return applyCorsHeaders(await handleMemoryDelete(request, env, episodeId), corsHeaders)
  }

  return applyCorsHeaders(new Response('Method Not Allowed', { status: 405 }), corsHeaders)
}
