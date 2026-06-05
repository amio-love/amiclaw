import { handleGetDashboard } from '../../packages/api/src/handlers/get-dashboard'
import { applyCorsHeaders, buildCorsHeaders } from '../../packages/api/src/cors'

interface Env {
  LEADERBOARD: KVNamespace
  DASHBOARD_TOKEN?: string
}

interface Context {
  request: Request
  env: Env
}

const CORS_METHODS = 'GET, OPTIONS'

export async function onRequest(context: Context): Promise<Response> {
  const { request, env } = context
  const corsHeaders = buildCorsHeaders(request, CORS_METHODS)

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (request.method === 'GET') {
    return applyCorsHeaders(
      await handleGetDashboard(request, env.LEADERBOARD, env.DASHBOARD_TOKEN),
      corsHeaders
    )
  }

  return applyCorsHeaders(new Response('Method Not Allowed', { status: 405 }), corsHeaders)
}
