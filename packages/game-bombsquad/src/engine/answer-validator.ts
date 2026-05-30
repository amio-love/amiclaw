import type { ModuleAnswer } from '@shared/manual-schema'

/**
 * Validates that a player's action matches the solved answer.
 * Returns true if the action is correct.
 */
export function validateAnswer(solved: ModuleAnswer, playerAction: unknown): boolean {
  switch (solved.type) {
    case 'wire': {
      const action = playerAction as { cutPosition: number }
      return action.cutPosition === solved.cutPosition
    }
    case 'dial': {
      const action = playerAction as { positions: number[] }
      return (
        action.positions.length === solved.positions.length &&
        action.positions.every((p, i) => p === solved.positions[i])
      )
    }
    case 'button': {
      const action = playerAction as { actionType: 'tap' | 'hold'; releasedOnColor?: string }
      if (action.actionType !== solved.action) return false
      if (solved.action === 'hold' && action.releasedOnColor !== solved.releaseOnColor) return false
      return true
    }
    case 'keypad': {
      const action = playerAction as { sequence: number[] }
      return (
        action.sequence.length === solved.sequence.length &&
        action.sequence.every((p, i) => p === solved.sequence[i])
      )
    }
  }
}
