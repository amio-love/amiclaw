/**
 * Pure gate for the companion's post-game (节拍 3) TEXT reaction on the result
 * page — the settlement 复盘 dedup lives here so it is unit-testable in isolation.
 *
 * The rule (companion-presence-design §节拍 3 + the one-recap-not-double ruling):
 * a mode② co-play settlement gets a factual companion reaction EXCEPT when the
 * run already received the SPOKEN closing recap on the win/lose burst — then the
 * settlement is already recapped, and a second (text) reaction would double it.
 *
 * All the impure reads (posture cache, beat log, the closing-recap dedup flag)
 * happen in the caller; this function is pure so both dedup directions and the
 * existing beat gating are exhaustively testable with plain inputs.
 */

import type { CompanionBeatLog, PostGameReactionInput } from '@shared/companion-presence'
import { buildPostGameReaction, canFirePostGameBeat } from '@shared/companion-presence'
import type { VoicePosture } from '@shared/companion-types'
import type { GameOutcome } from '@/store/game-context'

export interface CompanionReactionInput {
  /** True when the result page opened with no live run (recovery surface). */
  noRunData: boolean
  /** The mode② co-play run id, or null when this was not a co-play run. */
  companionRunId: string | null
  /** The settled outcome, or null when unresolved. */
  outcome: GameOutcome | null
  /**
   * Whether the SPOKEN closing recap already fired for this run
   * (`wasClosingRecapFired(companionRunId)`). When true the settlement is already
   * recapped by voice, so the text reaction is suppressed — one recap, not two.
   */
  recapAlreadyFired: boolean
  /**
   * Persisted voice posture (cache-first read; `null` when the cache is empty).
   * Quiet/denied freezes beats; a null / voice-default posture does not.
   */
  posture: VoicePosture | null
  /** Today's beat log (caps + per-run dedupe). */
  log: CompanionBeatLog
  /** The real run facts the reaction text is built from. */
  reactionFacts: PostGameReactionInput
  /** Injectable RNG for the tier probability (tests pin it). */
  rng?: () => number
}

/**
 * Decide the companion's post-game reaction text, or `null` when none should
 * show. `null` cases, in order: no run data / not a co-play run / unresolved
 * outcome; the closing recap already voiced this run (dedup); a quiet/denied
 * posture or exhausted daily cap freezes the beat. Otherwise the factual reaction
 * text for the run.
 */
export function deriveCompanionReaction(input: CompanionReactionInput): string | null {
  const {
    noRunData,
    companionRunId,
    outcome,
    recapAlreadyFired,
    posture,
    log,
    reactionFacts,
    rng,
  } = input
  if (noRunData || companionRunId === null || outcome === null) return null
  // Dedup — one recap, not two: the spoken closing recap already covered this run.
  if (recapAlreadyFired) return null
  const muted = posture === 'quiet-remembered' || posture === 'denied-remembered'
  const alreadyReacted = log.lastPostGameRunId === companionRunId
  if (!alreadyReacted && !canFirePostGameBeat({ log, gameRunId: companionRunId, muted, rng })) {
    return null
  }
  return buildPostGameReaction(reactionFacts)
}
