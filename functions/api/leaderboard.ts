import { handleGetLeaderboard } from '../../packages/api/src/handlers/get-leaderboard'
import { handlePostScore } from '../../packages/api/src/handlers/post-score'
import { applyCorsHeaders, buildCorsHeaders } from '../../packages/api/src/cors'
import { extractClaimedUserId } from '../../packages/api/src/auth/extract-claim'
import { guardClaimedUserId } from '../../packages/api/src/auth/guard'
import type { CompanionDb } from '../../packages/companion-memory/src/db'

interface Env {
  LEADERBOARD: KVNamespace
  // `AUTH` is the auth-session namespace. Optional here: the guard only needs
  // it when a submission actually CLAIMS a `user_id`. Current device-UUID
  // submissions claim none, so the guard never touches `AUTH` for them and the
  // existing anonymous flow is unaffected even before `AUTH` is provisioned.
  AUTH?: KVNamespace
  COMPANION_DB?: CompanionDb
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
    // Auth guard: reject only when a submission CLAIMS a `user_id` without a
    // valid matching session. A claim-less (anonymous device-UUID) submission
    // — the only kind today — passes straight through untouched.
    const claimedUserId = await extractClaimedUserId(request)
    if (claimedUserId) {
      if (!env.AUTH) {
        return applyCorsHeaders(
          new Response(JSON.stringify({ error: 'Authentication unavailable' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          }),
          corsHeaders
        )
      }
      const outcome = await guardClaimedUserId(env.AUTH, request, claimedUserId)
      if (!outcome.ok) {
        return applyCorsHeaders(
          new Response(JSON.stringify({ error: outcome.reason }), {
            status: outcome.status,
            headers: { 'Content-Type': 'application/json' },
          }),
          corsHeaders
        )
      }
    }
    return applyCorsHeaders(
      await handlePostScore(request, env.LEADERBOARD, {
        auth: env.AUTH,
        companionDb: env.COMPANION_DB,
      }),
      corsHeaders
    )
  }

  if (request.method === 'GET') {
    return applyCorsHeaders(await handleGetLeaderboard(request, env.LEADERBOARD), corsHeaders)
  }

  return applyCorsHeaders(new Response('Method Not Allowed', { status: 405 }), corsHeaders)
}
