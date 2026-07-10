import type { SimulationState } from '../engine/types'

export function isIntentDecisionBoundary(
  previous: SimulationState | undefined,
  current: SimulationState
): boolean {
  if (current.phase !== 'running') return false
  return (
    !previous ||
    previous.runId !== current.runId ||
    previous.decisionEpoch !== current.decisionEpoch
  )
}
