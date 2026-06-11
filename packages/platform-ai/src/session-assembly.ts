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
  userId: string
  providers: TurnProviders
  state: SessionState
}

/**
 * Run all fallible session-setup steps; return the full publishable bundle or
 * throw. Pure (no instance state touched): a throw leaves no residue, so a
 * failed create cannot bind a user, wire providers, or seed state.
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
  }
  return { userId, providers, state }
}
