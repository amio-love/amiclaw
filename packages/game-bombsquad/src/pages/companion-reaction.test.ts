import { describe, it, expect } from 'vitest'
import { deriveCompanionReaction, type CompanionReactionInput } from './companion-reaction'
import { emptyBeatLog, type CompanionBeatLog } from '@shared/companion-presence'

const RUN = 'run-abc'

function base(overrides: Partial<CompanionReactionInput> = {}): CompanionReactionInput {
  return {
    noRunData: false,
    companionRunId: RUN,
    outcome: 'defused',
    recapAlreadyFired: false,
    posture: 'voice-default',
    log: emptyBeatLog('2026-07-08'),
    reactionFacts: {
      outcome: 'defused',
      durationMs: 23_000,
      moduleCount: 4,
      completedModules: 4,
      strikeCount: 0,
    },
    rng: () => 0, // 0 < fireProbability(1) → the beat fires
    ...overrides,
  }
}

describe('deriveCompanionReaction — beat-3 gate + closing-recap dedup', () => {
  it('shows the factual reaction for a co-play settlement with no prior recap', () => {
    const text = deriveCompanionReaction(base())
    expect(text).not.toBeNull()
    expect(text).toContain('4 个模块全拆完')
  })

  it('DEDUP direction A — suppresses beat-3 when the spoken closing recap fired', () => {
    // The run already got the voice recap on the burst; the text reaction would
    // double it, so it is suppressed (one recap, not two).
    expect(deriveCompanionReaction(base({ recapAlreadyFired: true }))).toBeNull()
  })

  it('DEDUP direction B — shows beat-3 when the closing recap did NOT fire', () => {
    // The spoken recap did not run (session dropped / timed out): beat-3 is the
    // honest text fallback and still shows.
    expect(deriveCompanionReaction(base({ recapAlreadyFired: false }))).not.toBeNull()
  })

  it('suppresses for a non-co-play run (companionRunId null)', () => {
    expect(deriveCompanionReaction(base({ companionRunId: null }))).toBeNull()
  })

  it('suppresses when there is no run data or the outcome is unresolved', () => {
    expect(deriveCompanionReaction(base({ noRunData: true }))).toBeNull()
    expect(deriveCompanionReaction(base({ outcome: null }))).toBeNull()
  })

  it('a quiet/denied posture freezes the beat', () => {
    expect(deriveCompanionReaction(base({ posture: 'quiet-remembered' }))).toBeNull()
    expect(deriveCompanionReaction(base({ posture: 'denied-remembered' }))).toBeNull()
  })

  it('a null posture (empty cache) does NOT freeze the beat', () => {
    expect(deriveCompanionReaction(base({ posture: null }))).not.toBeNull()
  })

  it('re-renders the SAME reaction idempotently for an already-recorded run (StrictMode/refresh safe)', () => {
    // Already recorded for this run (lastPostGameRunId === run): the reaction is
    // shown consistently on a re-mount, bypassing the cap check — it must not
    // vanish just because the beat was already counted.
    const log: CompanionBeatLog = {
      ...emptyBeatLog('2026-07-08'),
      lastPostGameRunId: RUN,
      count: 5, // at the cap: a fresh beat could NOT fire, but this run already did
    }
    expect(deriveCompanionReaction(base({ log }))).not.toBeNull()
  })

  it('a fresh run at the daily cap does NOT fire', () => {
    const log: CompanionBeatLog = { ...emptyBeatLog('2026-07-08'), count: 5 }
    expect(deriveCompanionReaction(base({ log }))).toBeNull()
  })

  it('a failure outcome yields a facts-only reaction (no consolation)', () => {
    const text = deriveCompanionReaction(
      base({
        outcome: 'exploded',
        reactionFacts: {
          outcome: 'exploded',
          durationMs: null,
          moduleCount: 4,
          completedModules: 2,
          strikeCount: 3,
        },
      })
    )
    expect(text).toBe('三次失误，停在第 3 个模块。')
  })
})
