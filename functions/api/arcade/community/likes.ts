import {
  handleDeleteArcadeCommunityLike,
  handlePostArcadeCommunityLike,
} from '../../../../packages/api/src/handlers/arcade-community'
import type { ArcadeProfileApiEnv } from '../../../../packages/api/src/handlers/arcade-profile'
import { applyCorsHeaders, buildCorsHeaders } from '../../../../packages/api/src/cors'

interface Context {
  request: Request
  env: ArcadeProfileApiEnv
}

const CORS_METHODS = 'POST, DELETE, OPTIONS'

export async function onRequest(context: Context): Promise<Response> {
  const { request, env } = context
  const corsHeaders = buildCorsHeaders(request, CORS_METHODS)

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (request.method === 'POST') {
    return applyCorsHeaders(await handlePostArcadeCommunityLike(request, env), corsHeaders)
  }

  if (request.method === 'DELETE') {
    return applyCorsHeaders(await handleDeleteArcadeCommunityLike(request, env), corsHeaders)
  }

  return applyCorsHeaders(new Response('Method Not Allowed', { status: 405 }), corsHeaders)
}
