import { describe, expect, it } from 'vitest'
import { ScriptedPartnerBrain } from './brain'
import { levelByIndex } from '../game/levels'
import type { BoardSnapshot } from '../game/types'

function snapshot(overrides: Partial<BoardSnapshot>): BoardSnapshot {
  return {
    slots: 8,
    melody: new Array(8).fill(null),
    rhythm: new Array(8).fill(null),
    score: 0,
    target: 8,
    bloomed: false,
    partnerRemaining: { kick: 1, snare: 1, hihat: 1, clap: 1 },
    playerRemaining: { bell: 2, chime: 2, flute: 2, harp: 2 },
    partnerArchetype: 'rhythm_piece',
    trigger: 'player_planted',
    ...overrides,
  }
}

const lv1 = levelByIndex(1)!
const lv3 = levelByIndex(3)!

describe('ScriptedPartnerBrain', () => {
  // --- Anon opening move pre-seed (PR-2, r13 followup) ----------------------

  it('session_start yields exactly one greeting line', async () => {
    const brain = new ScriptedPartnerBrain(lv1.matrix, 'rhythm_piece')
    const r = await brain.react(snapshot({ trigger: 'session_start' }))
    expect(r.speech.length).toBeGreaterThan(0)
  })

  it('session_start applies exactly one legal opening place', async () => {
    const brain = new ScriptedPartnerBrain(lv1.matrix, 'rhythm_piece')
    const r = await brain.react(snapshot({ trigger: 'session_start' }))
    expect(r.actions).toHaveLength(1)
    expect(r.actions[0].op).toBe('place')
    // The opening piece is from the partner's own lane (rhythm), on a valid slot,
    // and material the partner actually has.
    expect(['kick', 'snare', 'hihat', 'clap']).toContain(r.actions[0].pieceType)
    expect(r.actions[0].slot).toBeGreaterThanOrEqual(1)
    expect(r.actions[0].slot).toBeLessThanOrEqual(8)
  })

  it('the opening move is deterministic (highest-synergy-potential piece on slot 1)', async () => {
    const brain = new ScriptedPartnerBrain(lv1.matrix, 'rhythm_piece')
    const r = await brain.react(snapshot({ trigger: 'session_start' }))
    // Lv1: kick synergizes with bell; kick has the best potential of the rhythm lane.
    expect(r.actions[0]).toEqual({ op: 'place', pieceType: 'kick', slot: 1 })
  })

  it('a later player_planted / player_spoke trigger never re-emits the opening move', async () => {
    const brain = new ScriptedPartnerBrain(lv1.matrix, 'rhythm_piece')
    await brain.react(snapshot({ trigger: 'session_start' }))
    // A later trigger with no player pieces on the board plans nothing (the opening
    // is not re-emitted — the pre-seed branch is trigger-gated to session_start).
    for (const trigger of ['player_planted', 'player_spoke'] as const) {
      const r = await brain.react(snapshot({ trigger }))
      expect(r.actions).toHaveLength(0)
    }
  })

  it('session_start with no partner material yields a greeting and no action', async () => {
    const brain = new ScriptedPartnerBrain(lv1.matrix, 'rhythm_piece')
    const r = await brain.react(
      snapshot({
        trigger: 'session_start',
        partnerRemaining: { kick: 0, snare: 0, hihat: 0, clap: 0 },
      })
    )
    expect(r.speech.length).toBeGreaterThan(0)
    expect(r.actions).toHaveLength(0)
  })

  it('lays the synergy rhythm under a planted melody', async () => {
    const brain = new ScriptedPartnerBrain(lv1.matrix, 'rhythm_piece')
    const board = snapshot({ melody: ['bell', ...new Array(7).fill(null)] })
    const r = await brain.react(board)
    expect(r.actions).toEqual([{ op: 'place', pieceType: 'kick', slot: 1 }]) // kick×bell synergy
  })

  it('avoids incompatible traps (Lv3 matrix)', async () => {
    const brain = new ScriptedPartnerBrain(lv3.matrix, 'rhythm_piece')
    // In Lv3, snare×bell and clap×bell are incompatible; kick×bell is synergy.
    const board = snapshot({
      melody: ['bell', ...new Array(7).fill(null)],
      partnerRemaining: { kick: 1, snare: 1, hihat: 1, clap: 2 },
    })
    const r = await brain.react(board)
    expect(r.actions[0]).toEqual({ op: 'place', pieceType: 'kick', slot: 1 })
  })

  it('swaps away a trap it can improve on', async () => {
    const brain = new ScriptedPartnerBrain(lv3.matrix, 'rhythm_piece')
    // snare sits under bell (incompatible -1); kick (synergy) is available.
    const board = snapshot({
      melody: ['bell', ...new Array(7).fill(null)],
      rhythm: ['snare', ...new Array(7).fill(null)],
      partnerRemaining: { kick: 1, snare: 0, hihat: 1, clap: 2 },
    })
    const r = await brain.react(board)
    expect(r.actions).toEqual([
      { op: 'remove', pieceType: 'snare', slot: 1 },
      { op: 'place', pieceType: 'kick', slot: 1 },
    ])
  })

  it('works when swapped to the melody side', async () => {
    const brain = new ScriptedPartnerBrain(lv1.matrix, 'melody_piece')
    const board = snapshot({
      partnerArchetype: 'melody_piece',
      rhythm: ['kick', ...new Array(7).fill(null)],
      partnerRemaining: { bell: 1, chime: 1, flute: 1, harp: 1 },
    })
    const r = await brain.react(board)
    expect(r.actions[0]).toEqual({ op: 'place', pieceType: 'bell', slot: 1 }) // kick×bell synergy
  })
})
