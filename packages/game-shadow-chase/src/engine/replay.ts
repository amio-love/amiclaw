import { RUN_CAP_TICKS } from './config'
import { advance } from './reducer'
import { createRunningState } from './rules'
import type { ReplayRecord, SimulationState } from './types'

export function replay(record: ReplayRecord, throughTick = RUN_CAP_TICKS): SimulationState {
  let state = createRunningState(record.mapId, record.difficulty, record.seed)
  while (state.phase === 'running' && state.tick < Math.min(throughTick, RUN_CAP_TICKS)) {
    state = advance(
      state,
      record.actions.filter((action) => action.applyAtTick === state.tick + 1)
    )
  }
  return state
}

export function replayDigest(state: SimulationState): string {
  const canonical = JSON.stringify(state)
  let hash = 0x811c9dc5
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
