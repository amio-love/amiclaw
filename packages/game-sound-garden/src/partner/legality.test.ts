import { describe, expect, it } from 'vitest'
import { filterLegalActions } from './legality'
import type { LegalityContext } from './legality'
import type { PartnerAction } from '../game/types'

function ctx(overrides: Partial<LegalityContext> = {}): LegalityContext {
  return {
    partnerArchetype: 'rhythm_piece',
    slots: 8,
    partnerSlots: new Array(8).fill(null),
    partnerRemaining: { kick: 1, snare: 1, hihat: 1, clap: 1 },
    ...overrides,
  }
}

describe('filterLegalActions', () => {
  it('accepts a legal place', () => {
    const { legal, dropped } = filterLegalActions(
      [{ op: 'place', pieceType: 'kick', slot: 1 }],
      ctx()
    )
    expect(legal).toHaveLength(1)
    expect(dropped).toHaveLength(0)
  })

  it('drops a wrong-archetype piece', () => {
    const actions: PartnerAction[] = [{ op: 'place', pieceType: 'bell', slot: 1 }]
    const { legal, dropped } = filterLegalActions(actions, ctx())
    expect(legal).toHaveLength(0)
    expect(dropped[0].reason).toContain('not a rhythm_piece')
  })

  it('drops an out-of-range slot', () => {
    const { legal } = filterLegalActions([{ op: 'place', pieceType: 'kick', slot: 99 }], ctx())
    expect(legal).toHaveLength(0)
  })

  it('drops a place with no piece left', () => {
    const c = ctx({ partnerRemaining: { kick: 0, snare: 1, hihat: 1, clap: 1 } })
    const { legal, dropped } = filterLegalActions([{ op: 'place', pieceType: 'kick', slot: 1 }], c)
    expect(legal).toHaveLength(0)
    expect(dropped[0].reason).toContain('no kick left')
  })

  it('drops a remove on an empty slot', () => {
    const { legal, dropped } = filterLegalActions(
      [{ op: 'remove', pieceType: 'kick', slot: 3 }],
      ctx()
    )
    expect(legal).toHaveLength(0)
    expect(dropped[0].reason).toContain('nothing to remove')
  })

  it('sequentially exhausts the pool across actions', () => {
    const c = ctx({ partnerRemaining: { kick: 1, snare: 0, hihat: 0, clap: 0 } })
    const actions: PartnerAction[] = [
      { op: 'place', pieceType: 'kick', slot: 1 },
      { op: 'place', pieceType: 'kick', slot: 2 }, // no kick left after the first
    ]
    const { legal, dropped } = filterLegalActions(actions, c)
    expect(legal).toHaveLength(1)
    expect(dropped).toHaveLength(1)
  })

  it('allows a swap (remove then place) freeing the displaced count', () => {
    const c = ctx({
      partnerSlots: ['snare', ...new Array(7).fill(null)],
      partnerRemaining: { kick: 1, snare: 0, hihat: 0, clap: 0 },
    })
    const actions: PartnerAction[] = [
      { op: 'remove', pieceType: 'snare', slot: 1 },
      { op: 'place', pieceType: 'kick', slot: 1 },
    ]
    const { legal, dropped } = filterLegalActions(actions, c)
    expect(legal).toHaveLength(2)
    expect(dropped).toHaveLength(0)
  })

  it('drops a forged remove whose pieceType is not the slot occupant (r14)', () => {
    const c = ctx({
      partnerSlots: ['kick', ...new Array(7).fill(null)],
      partnerRemaining: { kick: 0, snare: 1, hihat: 1, clap: 1 },
    })
    // slot 1 holds kick, not snare — this must be rejected, not silently
    // restoring kick's count for a later place to duplicate.
    const { legal, dropped } = filterLegalActions(
      [{ op: 'remove', pieceType: 'snare', slot: 1 }],
      c
    )
    expect(legal).toHaveLength(0)
    expect(dropped[0].reason).toContain('does not match kick')
  })

  it('a forged remove cannot free a count for a following place (r14)', () => {
    const c = ctx({
      partnerSlots: ['kick', ...new Array(7).fill(null)],
      partnerRemaining: { kick: 0, snare: 1, hihat: 1, clap: 1 },
    })
    const actions: PartnerAction[] = [
      { op: 'remove', pieceType: 'snare', slot: 1 }, // forged (slot 1 = kick)
      { op: 'place', pieceType: 'kick', slot: 3 }, // would duplicate the single kick
    ]
    const { legal, dropped } = filterLegalActions(actions, c)
    expect(legal).toHaveLength(0) // both dropped: forged remove, then no kick left
    expect(dropped).toHaveLength(2)
  })
})
