/**
 * Platform AI Worker entry (L2 §Mechanism Variant 3).
 *
 * Mounted same-origin at `claw.amio.fans/ai-ws/*` plus the bounded
 * `/ai-intent/shadow-chase` HTTP route (see `wrangler.toml`) so the auth-session
 * cookie rides along on both surfaces. The Worker:
 *   1. Dispatches the Shadow Chase intent POST before its WebSocket branch.
 *   2. Accepts `/ai-ws/*` WebSocket upgrades.
 *   3. Runs the handshake-time auth seam (cookie -> session-reader -> userId);
 *      an invalid/absent session is rejected at the handshake (401, no upgrade).
 *   4. Routes to the per-session `VoiceSessionDO` and forwards the upgrade.
 *
 * The agent is addressed by the URL path segment after `/ai-ws/` (the opaque
 * session name the client connects on); `getAgentByName` makes the same name
 * route to the same Agent DO (setting the partyserver room name so the forwarded
 * upgrade reaches `onConnect`). The resolved `userId` is forwarded so the DO can
 * bind it.
 */

import { getAgentByName, type AgentNamespace } from 'agents'
import { VoiceSessionDO } from './session-do'
import { CompanionConsolidatorDO } from './consolidator-do'
import { resolveSessionReader, type AuthSeamEnv } from './auth-seam'
import { resolveCompanionContext } from '../../companion-memory/src/resolver'
import { resolveIntentConfig } from './provider-config'
import { createIntentLlmProvider, type ProviderEnv } from './providers/factory'
import { handleShadowChaseIntent } from './shadow-chase-intent'
import { KvIntentRateLimiter } from './shadow-chase-intent-rate-limit'

/** Worker env: the Agent namespace bindings + auth seam + provider creds. */
export interface WorkerEnv extends Omit<AuthSeamEnv, 'AUTH'>, ProviderEnv {
  /** Shared auth-session KV. The intent route also uses it for a coarse limiter. */
  AUTH?: KVNamespace
  /** Agents-SDK namespace binding (`wrangler.toml` name `VOICE_SESSION`). */
  VOICE_SESSION: AgentNamespace<VoiceSessionDO>
  /**
   * Companion-memory bindings (optional — the voice pipeline runs memory-less
   * without them): the consolidator DO namespace (`COMPANION_CONSOLIDATOR`)
   * and Companion D1 (`COMPANION_DB`). Consumed by the session DO via its
   * env, not by this fetch handler.
   */
  COMPANION_CONSOLIDATOR?: DurableObjectNamespace
  COMPANION_DB?: D1Database
}

/** WS route prefix this Worker owns; pinned at L2 and must not drift. */
const AI_WS_PREFIX = '/ai-ws/'
const SHADOW_CHASE_INTENT_PATH = '/ai-intent/shadow-chase'

/**
 * Derive the DO session name from the request path. Everything after the
 * `/ai-ws/` prefix is the opaque session name the client connects on. An empty
 * name (a bare `/ai-ws/` connect) returns `null` -> 400.
 */
function sessionNameFromPath(pathname: string): string | null {
  if (!pathname.startsWith(AI_WS_PREFIX)) return null
  const name = pathname.slice(AI_WS_PREFIX.length)
  return name.length > 0 ? name : null
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url)

    // Dispatch the bounded HTTP intent route before the WebSocket-only branch.
    // Its session, limiter, provider, and companion dependencies are all
    // request-scoped; missing deployment wiring fails closed before model use.
    if (url.pathname === SHADOW_CHASE_INTENT_PATH) {
      if (env.AUTH && env.COMPANION_DB) {
        try {
          const intentConfig = resolveIntentConfig('shadow-chase')
          const llm = createIntentLlmProvider(intentConfig, env)
          return handleShadowChaseIntent(request, {
            sessionReader: resolveSessionReader(env),
            rateLimiter: new KvIntentRateLimiter(env.AUTH),
            resolveCompanionContext: (userId, gameId) =>
              resolveCompanionContext(env.COMPANION_DB as D1Database, userId, gameId),
            llm,
          })
        } catch {
          console.error(
            JSON.stringify({
              event: 'shadow-chase-intent',
              outcome: 'configuration-unavailable',
            })
          )
        }
      } else {
        console.error(
          JSON.stringify({
            event: 'shadow-chase-intent',
            outcome: 'binding-unavailable',
          })
        )
      }
      // Preserve method/origin/content/schema status precedence even when the
      // deployment is misconfigured; the handler returns 503 only after those
      // bounded checks and never receives an LLM dependency.
      return handleShadowChaseIntent(request, {})
    }

    // Only the same-origin WS route is served by this Worker.
    if (!url.pathname.startsWith(AI_WS_PREFIX)) {
      return new Response('not found', { status: 404 })
    }
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket upgrade', { status: 426 })
    }

    // Handshake-time auth: cookie -> session-reader -> userId. Reject before
    // any upgrade if there is no valid session.
    const reader = resolveSessionReader(env)
    const identity = await reader.resolve(request.headers.get('Cookie'))
    if (identity === null) {
      return new Response('unauthorized', { status: 401 })
    }

    const sessionName = sessionNameFromPath(url.pathname)
    if (sessionName === null) {
      return new Response('missing session name', { status: 400 })
    }

    // Route to the per-session Agent and forward the upgrade. The resolved userId
    // rides along in a header so the DO can bind ownership; this header is set
    // server-side here, never trusted from the client. `getAgentByName` resolves
    // the stub and sets the partyserver room name so the forwarded upgrade is
    // dispatched to the Agent's `onConnect`.
    const forwarded = new Request(request)
    forwarded.headers.set('X-Session-User-Id', identity.userId)
    const stub = await getAgentByName(env.VOICE_SESSION, sessionName)
    return stub.fetch(forwarded)
  },
}

export { VoiceSessionDO, CompanionConsolidatorDO }
