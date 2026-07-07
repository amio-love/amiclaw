/**
 * Shared env shape + body parsing for the `/api/companion/*` handler family.
 *
 * Identity rule (L2 invariant, enforced by construction): every handler
 * derives the owner `user_id` EXCLUSIVELY from `requireSession` — request
 * bodies and query strings are never consulted for an owner id. A body that
 * smuggles a `user_id` field is simply ignored: the parsed body types carry
 * no such field, and the store calls receive the session's user id.
 */

import type { CompanionDb } from '../../../companion-memory/src/db'
import {
  isVoicePosture,
  type CompanionRecord,
  type VoicePosture,
} from '../../../companion-memory/src/types'

/** Bindings the companion control plane needs (Pages dashboard-configured). */
export interface CompanionApiEnv {
  /** Auth-session KV namespace (shared session-reader source). */
  AUTH: KVNamespace
  /** Companion D1 database. `D1Database` satisfies `CompanionDb` structurally. */
  COMPANION_DB: CompanionDb
}

/** Parse a JSON body, or `null` on absent/malformed JSON (caller maps to 400). */
export async function parseJsonBody(request: Request): Promise<unknown | null> {
  try {
    return (await request.json()) as unknown
  } catch {
    return null
  }
}

/**
 * Narrow a companion row's `voice_posture` to the wire enum. The column CHECK
 * already enforces the enum in D1; this guards hand-edited rows and keeps the
 * wire type honest, degrading to the design's initial posture.
 */
export function wireVoicePosture(companion: Pick<CompanionRecord, 'voice_posture'>): VoicePosture {
  return isVoicePosture(companion.voice_posture) ? companion.voice_posture : 'voice-default'
}
