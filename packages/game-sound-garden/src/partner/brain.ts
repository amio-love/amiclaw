/**
 * Partner brain seam (L2 arch note B3 / B5).
 *
 * `PartnerBrain` is the one interface the game loop depends on. Round A ships
 * `ScriptedPartnerBrain` — a fully offline collaborator that holds the level's
 * harmony matrix (the player never sees it) and lays synergizing pieces on the
 * player's slots while avoiding the traps. Round B adds an `HttpPartnerBrain`
 * that POSTs the same snapshot to `/api/partner` (DeepSeek) and returns the
 * same `{speech, actions[]}` shape — a drop-in behind this interface.
 *
 * The brain PROPOSES actions; the legality guard (legality.ts) validates them
 * against the live board before they reach the engine. The brain simulates its
 * own remaining pool while planning so its proposals are usually already legal.
 */

import { MELODY_TYPES, RELATION_SCORES, RHYTHM_TYPES } from '../game/constants'
import type { MelodyType, PieceType, RhythmType } from '../game/constants'
import type {
  Archetype,
  BoardSnapshot,
  HarmonyMatrix,
  PartnerAction,
  PartnerReaction,
  Pool,
  RelationName,
} from '../game/types'

export interface PartnerBrain {
  react(snapshot: BoardSnapshot, utterance?: string): Promise<PartnerReaction>
}

interface Lines {
  greeting: string
  praise: string[]
  gentle: string[]
  fix: string[]
  observe: string[]
  idle: string[]
}

export class ScriptedPartnerBrain implements PartnerBrain {
  private readonly matrix: HarmonyMatrix
  private readonly partnerArchetype: Archetype
  private readonly valid: readonly PieceType[]
  private readonly lines: Lines
  private turn = 0

  constructor(matrix: HarmonyMatrix, partnerArchetype: Archetype) {
    this.matrix = matrix
    this.partnerArchetype = partnerArchetype
    this.valid = partnerArchetype === 'rhythm_piece' ? RHYTHM_TYPES : MELODY_TYPES
    this.lines = buildLines(partnerArchetype)
  }

  async react(snapshot: BoardSnapshot, _utterance?: string): Promise<PartnerReaction> {
    this.turn += 1
    if (snapshot.trigger === 'session_start') {
      // Anon-tier opening move (PR-2): unlike mode②, the anon scripted partner has
      // no AI-first greeting turn, so the opening is built here. Return the greeting
      // AND exactly one legal opening `place` — the partner-lane piece with the best
      // synergy potential, on the first empty slot — so the player always starts with
      // something to build against. The store applies it through `filterLegalActions`;
      // this branch is trigger-gated, so a later `player_planted` / `player_spoke`
      // never re-emits it.
      const opening = this.pickOpeningMove(snapshot)
      return { speech: this.lines.greeting, actions: opening ? [opening] : [] }
    }

    const playerLane = this.partnerArchetype === 'rhythm_piece' ? snapshot.melody : snapshot.rhythm
    const partnerLane = this.partnerArchetype === 'rhythm_piece' ? snapshot.rhythm : snapshot.melody
    const remaining: Pool = { ...snapshot.partnerRemaining }
    const partnerSlots: (PieceType | null)[] = [...partnerLane]

    const actions: PartnerAction[] = []
    let bestPlacedRelation: RelationName | null = null
    let fixedTrap = false

    for (let i = 0; i < snapshot.slots; i++) {
      const playerType = playerLane[i]
      if (!playerType) continue
      const current = partnerSlots[i]
      const plan = this.planSlot(playerType, current, remaining)
      if (plan.kind === 'none') continue

      if (current !== null && (plan.kind === 'swap' || plan.kind === 'remove')) {
        if (this.relationOf(current, playerType) === 'incompatible') fixedTrap = true
        actions.push({ op: 'remove', pieceType: current, slot: i + 1 })
        remaining[current] = (remaining[current] ?? 0) + 1
        partnerSlots[i] = null
      }
      if (plan.kind === 'place' || plan.kind === 'swap') {
        actions.push({ op: 'place', pieceType: plan.type, slot: i + 1 })
        remaining[plan.type] = (remaining[plan.type] ?? 0) - 1
        partnerSlots[i] = plan.type
        const rel = this.relationOf(plan.type, playerType)
        if (
          bestPlacedRelation === null ||
          RELATION_SCORES[rel] > RELATION_SCORES[bestPlacedRelation]
        ) {
          bestPlacedRelation = rel
        }
      }
    }

    return { speech: this.pickSpeech(snapshot.trigger, bestPlacedRelation, fixedTrap), actions }
  }

  /**
   * Pick the anon opening move: the partner-lane piece with the highest synergy
   * POTENTIAL (its best relation over every opposite-lane type), placed on the
   * first empty partner slot. Deterministic — ties break by `this.valid` order and
   * the lowest empty slot. Returns null if the partner has no material / no slot.
   */
  private pickOpeningMove(snapshot: BoardSnapshot): PartnerAction | null {
    const partnerLane = this.partnerArchetype === 'rhythm_piece' ? snapshot.rhythm : snapshot.melody
    const opposite = this.partnerArchetype === 'rhythm_piece' ? MELODY_TYPES : RHYTHM_TYPES
    let slot = -1
    for (let i = 0; i < snapshot.slots; i++) {
      if (partnerLane[i] === null) {
        slot = i + 1
        break
      }
    }
    if (slot === -1) return null
    let bestType: PieceType | null = null
    let bestScore = Number.NEGATIVE_INFINITY
    for (const type of this.valid) {
      if ((snapshot.partnerRemaining[type] ?? 0) <= 0) continue
      let potential = Number.NEGATIVE_INFINITY
      for (const opp of opposite) {
        potential = Math.max(potential, RELATION_SCORES[this.relationOf(type, opp as PieceType)])
      }
      if (potential > bestScore) {
        bestScore = potential
        bestType = type
      }
    }
    if (bestType === null) return null
    return { op: 'place', pieceType: bestType, slot }
  }

  /** Best move for one player-occupied slot: keep, swap, place, or clear a trap. */
  private planSlot(
    playerType: PieceType,
    current: PieceType | null,
    remaining: Pool
  ):
    | { kind: 'none' }
    | { kind: 'place'; type: PieceType }
    | { kind: 'swap'; type: PieceType }
    | { kind: 'remove' } {
    const currentScore =
      current !== null ? RELATION_SCORES[this.relationOf(current, playerType)] : 0
    // Candidate = any type still in the pool, or the piece already here.
    let bestType: PieceType | null = null
    let bestScore = currentScore
    for (const type of this.valid) {
      const available = (remaining[type] ?? 0) > 0 || type === current
      if (!available) continue
      const score = RELATION_SCORES[this.relationOf(type, playerType)]
      if (score > bestScore) {
        bestScore = score
        bestType = type
      }
    }
    // Leaving the slot empty scores 0 — clear a trap the pool can't improve on.
    if (bestScore < 0 && current !== null) return { kind: 'remove' }
    if (bestType === null || bestType === current) return { kind: 'none' }
    return { kind: current === null ? 'place' : 'swap', type: bestType }
  }

  private relationOf(partnerType: PieceType, playerType: PieceType): RelationName {
    const rhythm = (
      this.partnerArchetype === 'rhythm_piece' ? partnerType : playerType
    ) as RhythmType
    const melody = (
      this.partnerArchetype === 'rhythm_piece' ? playerType : partnerType
    ) as MelodyType
    return this.matrix[rhythm][melody]
  }

  private pickSpeech(
    trigger: BoardSnapshot['trigger'],
    bestRelation: RelationName | null,
    fixedTrap: boolean
  ): string {
    if (trigger === 'idle') return rotate(this.lines.idle, this.turn)
    if (fixedTrap) return rotate(this.lines.fix, this.turn)
    if (bestRelation === 'synergy') return rotate(this.lines.praise, this.turn)
    if (bestRelation === 'compatible' || bestRelation === 'neutral') {
      return rotate(this.lines.gentle, this.turn)
    }
    return rotate(this.lines.observe, this.turn)
  }
}

function rotate(pool: string[], turn: number): string {
  return pool[turn % pool.length]
}

function buildLines(partnerArchetype: Archetype): Lines {
  const partnerIsRhythm = partnerArchetype === 'rhythm_piece'
  const playerNoun = partnerIsRhythm ? '旋律花' : '节奏根'
  const partnerNoun = partnerIsRhythm ? '节奏根' : '旋律花'
  return {
    greeting: `我是你的园丁伙伴。你在时间线上种下${playerNoun}，我就在同一拍为它铺一层最合适的${partnerNoun}——一起让花园唱起来。`,
    praise: [
      '这一拍共鸣了，听见了吗？两株缠在一起唱。',
      '漂亮，正是我想配的那株。花园亮了一格。',
      '就是这个搭配——再来几拍就绽放了。',
    ],
    gentle: [
      '和上了，但还差点火候。换一株也许更亮。',
      '能长，先记着这拍，回头也许能更响。',
      '嗯，稳稳地长着。我们慢慢凑齐更好的。',
    ],
    fix: [
      '这两株有点吵，我换了根节奏压住它。',
      '刚才那拍刺耳，我给它挪了个更配的。',
      '别急，我把打架的那根换掉了，好多了。',
    ],
    observe: [
      '我先听听这一拍，暂时没有更好的根可配。',
      '手里的材料用得差不多了，挑着来。',
      '这拍先留着，等你再种一株我好接。',
    ],
    idle: [
      '还有空着的拍子，试试在那儿种一株？',
      '别停，多种几株，绽放就在眼前。',
      '想听哪种搭配？种下去我们一起试。',
    ],
  }
}
