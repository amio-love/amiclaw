import { describe, expect, it } from 'vitest'
import { GameStore } from './store'
import { LEVELS, levelByIndex } from './levels'
import type { PartnerBrain } from '../partner/brain'
import type { BoardSnapshot } from './types'

// Bus timers are pushed far out so only explicit runPartnerTurn calls react —
// keeps the store logic deterministic without fake timers.
const INERT_BUS = { debounceMs: 1_000_000, idleMs: 1_000_000 }

function lv(index: number) {
  const cfg = levelByIndex(index)
  if (!cfg) throw new Error(`no level ${index}`)
  return cfg
}

describe('GameStore', () => {
  it('opens with a greeting and an empty board', async () => {
    const store = new GameStore(lv(1), 'melody', { busConfig: INERT_BUS })
    await store.whenIdle()
    const s = store.getSnapshot()
    expect(s.chat.length).toBe(1)
    expect(s.score).toBe(0)
    expect(s.melody.every((x) => x === null)).toBe(true)
    store.dispose()
  })

  it('the partner lays a synergizing rhythm under a planted melody', async () => {
    const store = new GameStore(lv(1), 'melody', { busConfig: INERT_BUS })
    await store.whenIdle()
    store.plantPlayer('bell', 1)
    await store.runPartnerTurn('player_planted')
    const s = store.getSnapshot()
    expect(s.melody[0]).toBe('bell')
    expect(s.rhythm[0]).toBe('kick') // kick×bell = synergy in Lv1
    expect(s.score).toBe(3)
    expect(s.relations[0]).toBe('synergy')
    store.dispose()
  })

  it('a cooperative playthrough reaches bloom (no-fail free-flow)', async () => {
    const store = new GameStore(lv(1), 'melody', { busConfig: INERT_BUS })
    await store.whenIdle()
    for (const [type, slot] of [
      ['bell', 1],
      ['chime', 2],
      ['flute', 3],
    ] as const) {
      store.plantPlayer(type, slot)
      await store.runPartnerTurn('player_planted')
    }
    const s = store.getSnapshot()
    expect(s.score).toBeGreaterThanOrEqual(s.target)
    expect(s.bloomed).toBe(true)
    expect(s.chat.some((line) => line.text.includes('绽放'))).toBe(true)
    store.dispose()
  })

  it('enforces presentation-owned scarcity (F1)', async () => {
    const store = new GameStore(lv(2), 'melody', { busConfig: INERT_BUS })
    await store.whenIdle()
    // Lv2 pool has bell ×1.
    store.plantPlayer('bell', 1)
    store.plantPlayer('bell', 2) // no bell left — must be refused
    const s = store.getSnapshot()
    expect(s.melody[0]).toBe('bell')
    expect(s.melody[1]).toBe(null)
    const bell = s.palette.find((p) => p.type === 'bell')
    expect(bell?.remaining).toBe(0)
    store.dispose()
  })

  it('replacing a piece on a slot restores the old piece to the pool', async () => {
    const store = new GameStore(lv(1), 'melody', { busConfig: INERT_BUS })
    await store.whenIdle()
    store.plantPlayer('bell', 1)
    store.plantPlayer('chime', 1) // replace bell with chime on slot 1
    const s = store.getSnapshot()
    expect(s.melody[0]).toBe('chime')
    // bell returned to the pool (Lv1 bell ×2 → both still available)
    expect(s.palette.find((p) => p.type === 'bell')?.remaining).toBe(2)
    store.dispose()
  })

  it('supports side-swap (player controls the rhythm lane)', async () => {
    const store = new GameStore(lv(1), 'rhythm', { busConfig: INERT_BUS })
    await store.whenIdle()
    expect(store.getSnapshot().playerArchetype).toBe('rhythm_piece')
    store.plantPlayer('kick', 1)
    await store.runPartnerTurn('player_planted')
    const s = store.getSnapshot()
    expect(s.rhythm[0]).toBe('kick')
    expect(s.melody[0]).toBe('bell') // partner (melody) answers kick with bell synergy
    expect(s.score).toBe(3)
    store.dispose()
  })

  it('ships three levels', () => {
    expect(LEVELS.map((l) => l.index)).toEqual([1, 2, 3])
  })

  it('a malicious partner cannot corrupt material via forged remove actions (r14)', async () => {
    // Seeds one kick, then issues forged removes (occupied-wrong-type + empty
    // slot) plus a place that would DUPLICATE the single scarce kick if the
    // forged remove wrongly freed its count.
    const malicious: PartnerBrain = {
      react: async (snap: BoardSnapshot) => {
        if (snap.trigger === 'session_start') {
          return { speech: 'seed', actions: [{ op: 'place', pieceType: 'kick', slot: 1 }] }
        }
        return {
          speech: 'attack',
          actions: [
            { op: 'remove', pieceType: 'snare', slot: 1 }, // slot 1 holds kick, not snare
            { op: 'place', pieceType: 'kick', slot: 3 }, // would duplicate the single kick
            { op: 'remove', pieceType: 'clap', slot: 2 }, // empty slot
          ],
        }
      },
    }
    // Lv2 has kick ×1 — a duplication would be visible as a negative remaining.
    const store = new GameStore(lv(2), 'melody', { brain: malicious, busConfig: INERT_BUS })
    await store.whenIdle()
    store.plantPlayer('bell', 1) // scores kick×bell synergy on slot 1

    const before = store.getSnapshot()
    expect(before.rhythm[0]).toBe('kick')
    expect(before.melody[0]).toBe('bell')
    const beforeRhythm = [...before.rhythm]
    const beforeMelody = [...before.melody]
    const beforeScore = before.score

    await store.runPartnerTurn('player_planted')

    const after = store.getSnapshot()
    expect(after.rhythm).toEqual(beforeRhythm) // no kick@3 duplicate; kick@1 intact
    expect(after.melody).toEqual(beforeMelody)
    expect(after.score).toBe(beforeScore)
    expect(after.rhythm.filter((x) => x === 'kick').length).toBe(1) // single scarce kick
    store.dispose()
  })
})

// --- PR-2: settlement latch + platform (mode②) partner driver --------------

describe('GameStore — first-bloom settlement latch (PR-2 §4)', () => {
  it('latches settled on the first bloom and never un-settles on a later score dip', async () => {
    const store = new GameStore(lv(1), 'melody', { busConfig: INERT_BUS })
    await store.whenIdle()
    for (const [type, slot] of [
      ['bell', 1],
      ['chime', 2],
      ['flute', 3],
    ] as const) {
      store.plantPlayer(type, slot)
      await store.runPartnerTurn('player_planted')
    }
    expect(store.getSnapshot().bloomed).toBe(true)
    expect(store.getSnapshot().settled).toBe(true)

    // Removing the player's pieces drops the score below target — bloomed flips
    // back, but the settlement latch stays true for the run's lifetime.
    store.removePlayer(1)
    store.removePlayer(2)
    store.removePlayer(3)
    const s = store.getSnapshot()
    expect(s.bloomed).toBe(false)
    expect(s.settled).toBe(true)
    store.dispose()
  })

  it('is not settled before the first bloom', async () => {
    const store = new GameStore(lv(1), 'melody', { busConfig: INERT_BUS })
    await store.whenIdle()
    expect(store.getSnapshot().settled).toBe(false)
    store.dispose()
  })
})

describe('GameStore — platform (mode②) partner driver', () => {
  it('fires no scripted turn: no greeting, no opening move on the board', async () => {
    const store = new GameStore(lv(1), 'melody', { partnerMode: 'platform', busConfig: INERT_BUS })
    const s = store.getSnapshot()
    expect(s.chat.length).toBe(0) // no scripted greeting
    expect(s.rhythm.every((x) => x === null)).toBe(true) // no scripted opening move
    store.dispose()
  })

  it('applyPartnerActions runs the co_build moves through the same legality guard', async () => {
    const store = new GameStore(lv(1), 'melody', { partnerMode: 'platform', busConfig: INERT_BUS })
    store.plantPlayer('bell', 1)
    // A legal partner move (rhythm lane) is applied; an illegal one (melody piece
    // on the rhythm partner, out of range) is dropped by the guard.
    store.applyPartnerActions([
      { op: 'place', pieceType: 'kick', slot: 1 },
      { op: 'place', pieceType: 'bell', slot: 2 }, // wrong lane → dropped
    ])
    const s = store.getSnapshot()
    expect(s.rhythm[0]).toBe('kick') // legal move applied
    expect(s.rhythm[1]).toBeNull() // illegal move dropped
    expect(s.score).toBe(3) // kick×bell synergy
    store.dispose()
  })

  it('voiceGameState exposes the static sections + the live board publicContext', async () => {
    const store = new GameStore(lv(1), 'melody', { partnerMode: 'platform', busConfig: INERT_BUS })
    store.plantPlayer('bell', 1)
    const gs = store.voiceGameState()
    expect(gs.relevantSections).toEqual(['matrix', 'rules'])
    expect(gs.publicContext.melody[0]).toBe('bell')
    expect(gs.publicContext.partnerArchetype).toBe('rhythm_piece')
    expect(gs.publicContext.target).toBe(store.getSnapshot().target)
    store.dispose()
  })
})

describe('GameStore — late-reply session-version guard (r13 medium)', () => {
  it('drops applyPartnerActions that land after the store is disposed', async () => {
    const store = new GameStore(lv(1), 'melody', { partnerMode: 'platform', busConfig: INERT_BUS })
    store.plantPlayer('bell', 1)
    // The run is torn down (level switch / replay remounts a fresh store).
    store.dispose()
    // A late partner reply from the retired session must NOT mutate the engine.
    store.applyPartnerActions([{ op: 'place', pieceType: 'kick', slot: 1 }])
    expect(store.getSnapshot().rhythm.every((x) => x === null)).toBe(true)
  })
})
