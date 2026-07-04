/**
 * Session assembly — the FALLIBLE half of `VoiceSessionDO.createSession`,
 * extracted pure so the all-or-nothing property is unit-testable in Node
 * without any DO harness (see `session-identity.test.ts`). The real
 * `VoiceSessionDO` is also instantiable in tests via the
 * `vi.mock('cloudflare:workers')` production-class harness — see
 * `session-do-usage-flush.test.ts` — but the pure extraction remains the
 * cheapest place to pin the all-or-nothing publish property.
 *
 * Both setup steps can throw:
 *  - `resolveConfig` on an unregistered `gameId` (loud-fail, no default game);
 *  - `createProviders` when a selected REAL provider is missing its secret
 *    (e.g. `deepseek` without `DEEPSEEK_API_KEY`, `volcengine` without
 *    `VOLC_API_KEY`).
 *
 * This function runs every fallible step into locals and returns the complete
 * bundle only when ALL of them succeeded — it never partially constructs. The
 * DO then publishes the bundle to its instance fields in one uninterrupted
 * synchronous block, so observers keyed off `boundIdentity()` only ever see a
 * session that is fully constructed or entirely absent, never half-bound.
 */

import type { CompanionContext } from '../../companion-memory/src/types'
import type { ManualData } from './contract'
import type { GameState } from './manual-injection'
import { resolveConfig } from './provider-config'
import { createProviders, type ProviderEnv } from './providers/factory'
import type { SessionState, TurnProviders } from './turn-pipeline'
import { resolveVendorVoice } from './voice-id-mapping'

/** Everything `createSession` publishes, assembled atomically or not at all. */
export interface AssembledSession {
  /**
   * Freshly minted opaque session id (`crypto.randomUUID()`), one per
   * successful assembly. Deliberately NOT the Durable Object id (and not a
   * "DO id + generation counter" composite): the same-named DO instance hosts
   * many logical sessions over its lifetime — every reconnect/`create` after a
   * `clearSession`, and any in-memory counter resets to zero on a DO
   * eviction/restart — so a DO-derived id would collide across distinct
   * sessions wherever the id must be globally unique: the per-session
   * `usage:{date}:{user_id}:{session_id}` metering key, and the
   * companion-memory capture event id `session-summary:{session_id}`
   * (`idempotency.ts` — two runs colliding there would silently swallow the
   * second run's summary).
   */
  sessionId: string
  userId: string
  providers: TurnProviders
  state: SessionState
}

/**
 * Optional assembly-time companion-memory inputs (additive seam). The
 * RESOLUTION of `companionContext` (the companion-memory resolver call over
 * D1) happens before this function, on the DO's create path — this function
 * stays synchronous, and the all-or-nothing publish property is untouched.
 * The companion's `voice_id`, however, is mapped to vendor voice params
 * INSIDE this function (synchronous, total — see `voice-id-mapping.ts`) and
 * threaded into the TTS provider. An absent context assembles the exact
 * pre-companion session.
 */
export interface AssembleSessionExtras {
  companionContext?: CompanionContext
  gameRunId?: string
}

/**
 * Run all fallible session-setup steps; return the full publishable bundle or
 * throw. Pure aside from the session-id mint (no instance state touched): a
 * throw leaves no residue, so a failed create cannot bind a user, wire
 * providers, or seed state.
 */
export function assembleSession(
  gameId: string,
  userId: string,
  manualData: ManualData,
  gameState: GameState | undefined,
  env: ProviderEnv,
  extras: AssembleSessionExtras = {}
): AssembledSession {
  const config = resolveConfig(gameId)
  // Companion voice wiring (L2 §Mechanism Variant 2): the companion's
  // platform-neutral `voice_id` resolves to vendor voice params HERE, at
  // assembly. Resolution is total — an unknown id or an unfilled placeholder
  // degrades to `undefined` (the provider's default voice, warned inside
  // `resolveVendorVoice`), so a voice-mapping gap can never fail session
  // creation and the all-or-nothing publish property is untouched. No
  // companion context -> no override -> the exact pre-companion wiring.
  const vendorVoice =
    extras.companionContext === undefined
      ? undefined
      : resolveVendorVoice(extras.companionContext.companion.voice_id, env)
  const providers = createProviders(
    config,
    env,
    vendorVoice === undefined ? undefined : { ttsSpeaker: vendorVoice.volcengineVoiceType }
  )
  const state: SessionState = {
    config,
    manualData,
    gameState: gameState ?? { relevantSections: [] },
    history: [],
    turnCount: 0,
    usage: { llmInputTokens: 0, llmOutputTokens: 0, sttInputSeconds: 0, ttsOutputSeconds: 0 },
    // Latches to 'derived-from-bytes' on the first turn whose STT seconds did
    // not come from the provider's own report (see `SessionState.sttSource`).
    sttSource: 'provider-reported',
    ...(extras.companionContext !== undefined ? { companionContext: extras.companionContext } : {}),
    ...(extras.gameRunId !== undefined ? { gameRunId: extras.gameRunId } : {}),
  }
  return { sessionId: crypto.randomUUID(), userId, providers, state }
}
