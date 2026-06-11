import { handleClaimCorrection } from '../../../../../packages/api/src/handlers/companion-profile-claim'
import type { CompanionApiEnv } from '../../../../../packages/api/src/handlers/companion-shared'
import { applyCorsHeaders, buildCorsHeaders } from '../../../../../packages/api/src/cors'

interface Context {
  request: Request
  env: CompanionApiEnv
  params: { id?: string }
}

const CORS_METHODS = 'POST, OPTIONS'

export async function onRequest(context: Context): Promise<Response> {
  const { request, env, params } = context
  const corsHeaders = buildCorsHeaders(request, CORS_METHODS)

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  const claimId = params.id
  if (typeof claimId !== 'string' || claimId.length === 0) {
    return applyCorsHeaders(new Response('Not Found', { status: 404 }), corsHeaders)
  }

  if (request.method === 'POST') {
    return applyCorsHeaders(await handleClaimCorrection(request, env, claimId), corsHeaders)
  }

  return applyCorsHeaders(new Response('Method Not Allowed', { status: 405 }), corsHeaders)
}
