import { LEASE_MAX_TICKS, LEASE_MIN_TICKS } from '../model/intent-contract'
import { isCanonicalUuid } from './config'
import { getMap } from './maps'
import { nextStepOnShortestPath } from './pathfinding'
import type { ModelProposal, SimulationState } from './types'

export type ProposalValidation = { ok: true } | { ok: false; reason: string }

export function validateModelProposal(
  state: SimulationState,
  input: {
    requestId: string
    runId: string
    decisionEpoch: number
    proposal: ModelProposal
    leaseTicks: number
  }
): ProposalValidation {
  if (state.phase !== 'running') return { ok: false, reason: 'terminal' }
  if (!isCanonicalUuid(input.requestId) || input.runId !== state.runId) {
    return { ok: false, reason: 'identity' }
  }
  if (input.decisionEpoch !== state.decisionEpoch) return { ok: false, reason: 'epoch' }
  if (
    !Number.isSafeInteger(input.leaseTicks) ||
    input.leaseTicks < LEASE_MIN_TICKS ||
    input.leaseTicks > LEASE_MAX_TICKS
  ) {
    return { ok: false, reason: 'lease' }
  }
  const { proposal } = input
  if (!['support', 'scout', 'anchor'].includes(proposal.intent)) {
    return { ok: false, reason: 'intent' }
  }
  if (proposal.intent === 'support' || proposal.intent === 'anchor') {
    return proposal.targetObjectiveId ? { ok: false, reason: 'unexpected-target' } : { ok: true }
  }
  const objective = state.objectives.find(
    (candidate) => candidate.id === proposal.targetObjectiveId && !candidate.collected
  )
  if (!objective) return { ok: false, reason: 'target' }
  const path = nextStepOnShortestPath(
    getMap(state.mapId),
    state.actors.companion.position,
    objective.position
  )
  return path ? { ok: true } : { ok: false, reason: 'unreachable-target' }
}
