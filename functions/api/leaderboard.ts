import { handleGetLeaderboard } from '../../packages/api/src/handlers/get-leaderboard'
import { handlePostScore } from '../../packages/api/src/handlers/post-score'
import { applyCorsHeaders, buildCorsHeaders } from '../../packages/api/src/cors'

interface Env {
  LEADERBOARD: KVNamespace
}

interface Context {
  request: Request
  env: Env
}

const CORS_METHODS = 'GET, POST, OPTIONS'

export async function onRequest(context: Context): Promise<Response> {
  const { request, env } = context
  const corsHeaders = buildCorsHeaders(request, CORS_METHODS)

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (request.method === 'POST') {
    return applyCorsHeaders(await handlePostScore(request, env.LEADERBOARD), corsHeaders)
  }

  if (request.method === 'GET') {
    return applyCorsHeaders(await handleGetLeaderboard(request, env.LEADERBOARD), corsHeaders)
  }

  return applyCorsHeaders(new Response('Method Not Allowed', { status: 405 }), corsHeaders)
}
