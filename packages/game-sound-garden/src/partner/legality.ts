/**
 * Partner action legality guard (L2 arch note B5, risk #1).
 *
 * A partner brain — scripted now, an LLM in Round B — can propose illegal or
 * hallucinated moves: a piece on an occupied-by-itself slot, a piece it has run
 * out of, a wrong-archetype type, an out-of-range slot, or a remove on an empty
 * slot. This guard validates each proposed action against the live board BEFORE
 * it reaches `performAction`, dropping the illegal ones (the caller logs them).
 *
 * Actions are validated SEQUENTIALLY against a working copy of the board so a
 * place that consumes the partner's last piece correctly invalidates a later
 * place of the same type in the same reaction.
 */

import { MELODY_TYPES, RHYTHM_TYPES } from '../game/constants'
import type { PieceType } from '../game/constants'
import type { Archetype, PartnerAction, Pool } from '../game/types'

export interface LegalityContext {
  partnerArchetype: Archetype
  slots: number
  /** Partner's current lane occupancy, 0-based by slot index (type or null). */
  partnerSlots: (PieceType | null)[]
  /** Partner's remaining per-type pool. */
  partnerRemaining: Pool
}

export interface DroppedAction {
  action: PartnerAction
  reason: string
}

export interface GuardResult {
  legal: PartnerAction[]
  dropped: DroppedAction[]
}

function validTypesFor(archetype: Archetype): readonly PieceType[] {
  return archetype === 'rhythm_piece' ? RHYTHM_TYPES : MELODY_TYPES
}

/** Validate + sequentially simulate a partner reaction's actions. */
export function filterLegalActions(actions: PartnerAction[], ctx: LegalityContext): GuardResult {
  const legal: PartnerAction[] = []
  const dropped: DroppedAction[] = []
  const valid = validTypesFor(ctx.partnerArchetype)
  // Working copies mutated as legal actions are accepted.
  const slots = [...ctx.partnerSlots]
  const remaining: Pool = { ...ctx.partnerRemaining }

  for (const action of actions) {
    const idx = action.slot - 1
    if (!valid.includes(action.pieceType)) {
      dropped.push({ action, reason: `${action.pieceType} is not a ${ctx.partnerArchetype}` })
      continue
    }
    if (action.slot < 1 || action.slot > ctx.slots) {
      dropped.push({ action, reason: `slot ${action.slot} out of range` })
      continue
    }
    if (action.op === 'remove') {
      if (slots[idx] === null) {
        dropped.push({ action, reason: `nothing to remove at slot ${action.slot}` })
        continue
      }
      // The remove's pieceType MUST match the real occupant. A forged type
      // would restore the wrong material count here while the store's remove
      // no-ops a non-placed element — leaving the real piece in place and its
      // count phantom-freed for a later place to duplicate. Reject-with-log.
      if (slots[idx] !== action.pieceType) {
        dropped.push({
          action,
          reason: `remove ${action.pieceType} does not match ${slots[idx]} at slot ${action.slot}`,
        })
        continue
      }
      remaining[action.pieceType] = (remaining[action.pieceType] ?? 0) + 1
      slots[idx] = null
      legal.push(action)
      continue
    }
    // op === 'place'
    if (slots[idx] === action.pieceType) {
      dropped.push({ action, reason: `${action.pieceType} already at slot ${action.slot}` })
      continue
    }
    if ((remaining[action.pieceType] ?? 0) <= 0) {
      dropped.push({ action, reason: `no ${action.pieceType} left in pool` })
      continue
    }
    // Replacement restores the displaced piece's count.
    const displaced = slots[idx]
    if (displaced !== null) remaining[displaced] = (remaining[displaced] ?? 0) + 1
    remaining[action.pieceType] = (remaining[action.pieceType] ?? 0) - 1
    slots[idx] = action.pieceType
    legal.push(action)
  }

  return { legal, dropped }
}
