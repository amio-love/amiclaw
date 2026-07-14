/**
 * Platform AI Worker entry (L2 §Mechanism Variant 3).
 *
 * Mounted same-origin at `claw.amio.fans/ai-ws/*` plus the bounded `/ai-intent/*`
 * HTTP routes (see `wrangler.toml`) so the auth-session cookie rides along on
 * every surface. The Worker dispatches, in order, before its WebSocket branch:
 *   1. `POST /ai-intent/shadow-chase` — the Shadow Chase bounded intent.
 *   2. `POST /ai-intent/companion-proxy-message` — companion-proxy-social V1
 *      (甲's companion autonomously authors one public line; silent skips).
 *   3. `POST /ai-intent/companion-proxy-reply` — companion-proxy-social V2
 *      (乙's companion replies once; explicit status codes).
 *   4. `/ai-ws/*` WebSocket upgrades — runs the handshake-time auth seam (cookie
 *      -> session-reader -> userId; invalid/absent session rejected at the
 *      handshake, 401, no upgrade), then routes to the per-session
 *      `VoiceSessionDO` and forwards the upgrade.
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
import { readProxySocialEnabled } from '../../companion-memory/src/store'
import {
  countAuthorProxyMessagesForDay,
  findInWindowCommunityEvent,
  insertProxyMessage,
  insertProxyReply,
  loadProxyMessage,
  readArcadePublicProfile,
  readProxyCandidateEvents,
  type ArcadeProfileDb,
} from '../../arcade-profile/src/store'
import { resolveIntentConfig } from './provider-config'
import { createIntentLlmProvider, type ProviderEnv } from './providers/factory'
import { handleShadowChaseIntent } from './shadow-chase-intent'
import { handleCompanionProxyMessage, handleCompanionProxyReply } from './companion-proxy-intent'
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
/** Companion-proxy-social bounded routes (L2 §Interface). Dispatched by this
    Worker's fetch handler alongside the shadow-chase intent, before the WS branch.
    Each path is registered as a same-zone path-exact `[[routes]]` pattern in
    `wrangler.toml` (parallel to `/ai-intent/shadow-chase`) so the chain is live
    in prod and the session cookie rides along on the POST. */
const COMPANION_PROXY_MESSAGE_PATH = '/ai-intent/companion-proxy-message'
const COMPANION_PROXY_REPLY_PATH = '/ai-intent/companion-proxy-reply'
/** Distinct KV rate-limit namespace so proxy calls do not share the shadow-chase
    per-user budget. */
const PROXY_RATE_LIMIT_PREFIX = 'ratelimit:proxy-social:user:'

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

    // Companion-proxy-social V1 (甲's companion authors one public line). All
    // reads/writes are wired to arcade-profile store fns; the companion read
    // omits gameId (account-global identity + cross-game memory). Same fail-closed
    // shape as shadow-chase: missing bindings → the handler's post-bounded 503.
    if (url.pathname === COMPANION_PROXY_MESSAGE_PATH) {
      if (env.AUTH && env.COMPANION_DB) {
        try {
          const db = env.COMPANION_DB as ArcadeProfileDb
          const llm = createIntentLlmProvider(resolveIntentConfig('companion-proxy-message'), env)
          return handleCompanionProxyMessage(request, {
            sessionReader: resolveSessionReader(env),
            rateLimiter: new KvIntentRateLimiter(env.AUTH, PROXY_RATE_LIMIT_PREFIX),
            resolveCompanionContext: (userId) =>
              resolveCompanionContext(env.COMPANION_DB as D1Database, userId),
            readProxySocialEnabled: (userId) =>
              readProxySocialEnabled(env.COMPANION_DB as D1Database, userId),
            readPublicProfile: (userId) => readArcadePublicProfile(db, userId),
            readCandidates: (userId) => readProxyCandidateEvents(db, userId),
            countAuthorMessagesForDay: (userId) => countAuthorProxyMessagesForDay(db, userId),
            insertMessage: (input) => insertProxyMessage(db, input),
            newMessageId: () => crypto.randomUUID(),
            llm,
          })
        } catch {
          console.error(
            JSON.stringify({
              event: 'companion-proxy-message',
              outcome: 'configuration-unavailable',
            })
          )
        }
      } else {
        console.error(
          JSON.stringify({ event: 'companion-proxy-message', outcome: 'binding-unavailable' })
        )
      }
      return handleCompanionProxyMessage(request, {})
    }

    // Companion-proxy-social V2 (乙's companion replies once). Loads the message +
    // reply-existence flag, guards the 14-day anchor window via the live feed, and
    // writes the single reply. User-initiated → the handler returns explicit codes.
    if (url.pathname === COMPANION_PROXY_REPLY_PATH) {
      if (env.AUTH && env.COMPANION_DB) {
        try {
          const db = env.COMPANION_DB as ArcadeProfileDb
          const llm = createIntentLlmProvider(resolveIntentConfig('companion-proxy-reply'), env)
          return handleCompanionProxyReply(request, {
            sessionReader: resolveSessionReader(env),
            rateLimiter: new KvIntentRateLimiter(env.AUTH, PROXY_RATE_LIMIT_PREFIX),
            resolveCompanionContext: (userId) =>
              resolveCompanionContext(env.COMPANION_DB as D1Database, userId),
            readPublicProfile: (userId) => readArcadePublicProfile(db, userId),
            loadMessage: (id) => loadProxyMessage(db, id),
            findInWindowEvent: (eventId) => findInWindowCommunityEvent(db, eventId),
            insertReply: (input) => insertProxyReply(db, input),
            llm,
          })
        } catch {
          console.error(
            JSON.stringify({ event: 'companion-proxy-reply', outcome: 'configuration-unavailable' })
          )
        }
      } else {
        console.error(
          JSON.stringify({ event: 'companion-proxy-reply', outcome: 'binding-unavailable' })
        )
      }
      return handleCompanionProxyReply(request, {})
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
