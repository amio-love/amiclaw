import type { Direction } from '../engine/types'

export const MAX_BUFFERED_DISCRETE_MOVES = 8

export interface BufferedMove {
  direction: Direction
  actionSequence: number
}

export interface InputController {
  enqueue(move: BufferedMove): boolean
  take(): BufferedMove | undefined
  clear(): void
  snapshot(): BufferedMove[]
}

export function createInputController(): InputController {
  const moves: BufferedMove[] = []
  return {
    enqueue(move) {
      if (moves.length >= MAX_BUFFERED_DISCRETE_MOVES) return false
      moves.push(move)
      return true
    },
    take: () => moves.shift(),
    clear() {
      moves.length = 0
    },
    snapshot: () => moves.map((move) => ({ ...move })),
  }
}
