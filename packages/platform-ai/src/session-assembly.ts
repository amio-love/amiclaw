/**
 * Session assembly — the FALLIBLE half of `VoiceSessionDO.createSession`,
 * extracted pure so the all-or-nothing property is unit-testable in Node
 * (the DO class imports `cloudflare:workers` and cannot be instantiated in
 * the test environment — see `session-identity.test.ts`).
 *
 * Both setup steps can throw:
 *  - `resolveConfig` on an unregistered `gameId` (loud-fail, no default game);
 *  - `createProviders` when a selected REAL provider is missing its secret
 *    (e.g. `deepseek` without `DEEPSEEK_API_KEY`, `volcengine` without
 *    `VOLC_APP_ID`/`VOLC_ACCESS_KEY`).
 *
 * This function runs every fallible step into locals and returns the complete
 * bundle only when ALL of them succeeded — it never partially constructs. The
 * DO then publishes the bundle to its instance fields in one uninterrupted
 * synchronous block, so observers keyed off `boundIdentity()` only ever see a
 * session that is fully constructed or entirely absent, never half-bound.
 */

import type { ManualData } from './contract'
import type { GameState } from './manual-injection'
import { resolveConfig } from './provider-config'
import { createProviders, type ProviderEnv } from './providers/factory'
import type { SessionState, TurnProviders } from './turn-pipeline'

/** Everything `createSession` publishes, assembled atomically or not at all. */
export interface AssembledSession {
  /**
   * Freshly minted opaque session id (`crypto.randomUUID()`), one per
   * successful assembly. Deliberately NOT the Durable Object id (and not a
   * "DO id + generation counter" composite): the same-named DO instance hosts
   * many logical sessions over its lifetime — every reconnect/`create` after a
   * `clearSession`, and any in-memory counter resets to zero on a DO
   * eviction/restart — so a DO-derived id would collide across distinct
   * sessions wherever the id must be globally unique (the per-session
   * `usage:{date}:{user_id}:{session_id}` metering key).
   */
  sessionId: string
  userId: string
  providers: TurnProviders
  state: SessionState
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
  env: ProviderEnv
): AssembledSession {
  const config = resolveConfig(gameId)
  const providers = createProviders(config, env)
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
  }
  return { sessionId: crypto.randomUUID(), userId, providers, state }
}
