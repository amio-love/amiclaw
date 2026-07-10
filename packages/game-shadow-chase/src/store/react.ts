import { useSyncExternalStore } from 'react'

import type { GameStore } from './game-store'

export function useGameStore(store: GameStore) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}
