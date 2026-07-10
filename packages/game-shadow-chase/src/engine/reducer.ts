import {
  DIFFICULTY_CONFIG,
  MIN_RUN_TICKS,
  OPENING_GRACE_TICKS,
  RUN_CAP_TICKS,
  SWAP_COOLDOWN_TICKS,
  isSafeTick,
} from './config'
import { companionNextStep } from './companion-policy'
import { validateModelProposal } from './intent-legality'
import { getMap } from './maps'
import { nextStepOnShortestPath } from './pathfinding'
import { pursuerNextStep } from './pursuer-policy'
import { coordinatesEqual, isWalkable, moved } from './rules'
import type {
  Coordinate,
  EngineAction,
  EngineEvent,
  QueuedAction,
  ShadowActor,
  SimulationState,
} from './types'

function crossed(
  leftStart: Coordinate,
  leftEnd: Coordinate,
  rightStart: Coordinate,
  rightEnd: Coordinate
): boolean {
  return coordinatesEqual(leftStart, rightEnd) && coordinatesEqual(leftEnd, rightStart)
}

function cloneState(state: SimulationState): SimulationState {
  return structuredClone(state)
}

export interface ReducerPolicies {
  companion(state: SimulationState): Coordinate
  pursuer(state: SimulationState, nextTick: number): Coordinate
}

const DEFAULT_POLICIES: ReducerPolicies = {
  companion: companionNextStep,
  pursuer: pursuerNextStep,
}

export function advance(
  state: SimulationState,
  queuedActions: QueuedAction[],
  policies: ReducerPolicies = DEFAULT_POLICIES
): SimulationState {
  if (state.phase !== 'running') return state
  if (!isSafeTick(state.tick) || state.tick >= RUN_CAP_TICKS) {
    throw new Error('Unsafe completed tick')
  }
  const nextTick = state.tick + 1
  const map = getMap(state.mapId)
  const next = cloneState(state)
  const tickEvents: EngineEvent[] = []
  const actions = queuedActions
    .filter((queued) => queued.applyAtTick === nextTick)
    .sort((left, right) => left.sequence - right.sequence)
  if (queuedActions.some((queued) => !Number.isSafeInteger(queued.applyAtTick))) {
    throw new Error('Unsafe action tick')
  }

  let playerAction: Extract<EngineAction, { type: 'player-move' | 'player-target' }> | undefined
  let swapRequested = false
  for (const queued of actions) {
    const action = queued.action
    if (action.type === 'player-move' || action.type === 'player-target') playerAction = action
    if (action.type === 'swap' && !swapRequested) swapRequested = true
    if (action.type === 'companion-command') {
      const target = next.objectives.find(
        (objective) => objective.id === action.targetObjectiveId && !objective.collected
      )
      next.command = {
        intent: action.command,
        ...(action.command === 'split' && target ? { targetObjectiveId: target.id } : {}),
      }
      next.activeModelLease = undefined
      next.decisionEpoch += 1
      tickEvents.push({ tick: nextTick, type: 'command', detail: action.command })
    }
    if (action.type === 'accept-model-proposal') {
      const validation = validateModelProposal(next, action)
      if (validation.ok) {
        next.activeModelLease = {
          ...action.proposal,
          requestId: action.requestId,
          acceptedTick: nextTick,
          expiryTick: nextTick + action.leaseTicks - 1,
        }
        tickEvents.push({ tick: nextTick, type: 'model-lease', detail: action.proposal.intent })
      } else {
        tickEvents.push({ tick: nextTick, type: 'model-rejected', detail: validation.reason })
      }
    }
  }
  if (next.activeModelLease && next.activeModelLease.expiryTick < nextTick) {
    next.activeModelLease = undefined
  }

  const starts = {
    player: { ...state.actors.player.position },
    companion: { ...state.actors.companion.position },
    pursuer: { ...state.actors.pursuer.position },
  }
  let playerEnd = starts.player
  if (state.actors.player.status === 'free' && playerAction) {
    const candidate =
      playerAction.type === 'player-move'
        ? moved(starts.player, playerAction.direction)
        : nextStepOnShortestPath(map, starts.player, playerAction.target)
    if (candidate && isWalkable(map, candidate)) playerEnd = candidate
  }
  let companionEnd = policies.companion(next)
  const pursuerEnd =
    nextTick <= OPENING_GRACE_TICKS
      ? next.actors.pursuer.position
      : policies.pursuer(next, nextTick)
  if (next.actors.pursuer.target !== state.actors.pursuer.target) {
    next.decisionEpoch += 1
  }

  const canSwap =
    swapRequested &&
    state.actors.player.status === 'free' &&
    state.actors.companion.status === 'free' &&
    nextTick >= state.cooldowns.swapReadyTick
  if (canSwap) {
    playerEnd = starts.companion
    companionEnd = starts.player
    next.cooldowns.swapReadyTick = nextTick + SWAP_COOLDOWN_TICKS
    tickEvents.push({ tick: nextTick, type: 'swap' })
  } else {
    if (swapRequested) tickEvents.push({ tick: nextTick, type: 'swap-rejected' })
    const bothFree =
      state.actors.player.status === 'free' && state.actors.companion.status === 'free'
    const sameOrdinaryTile =
      bothFree &&
      coordinatesEqual(playerEnd, companionEnd) &&
      !(next.exit.enabled && coordinatesEqual(playerEnd, next.exit.position))
    const crossing = bothFree && crossed(starts.player, playerEnd, starts.companion, companionEnd)
    if (sameOrdinaryTile || crossing) {
      playerEnd = starts.player
      companionEnd = starts.companion
    }
  }

  next.actors.player.position = playerEnd
  next.actors.companion.position = companionEnd
  next.actors.pursuer.position = pursuerEnd
  for (const actorId of ['player', 'companion'] as const) {
    if (!coordinatesEqual(starts[actorId], next.actors[actorId].position)) {
      tickEvents.push({ tick: nextTick, type: 'move', actorId })
    }
  }

  const newlyCaptured = new Set<'player' | 'companion'>()
  for (const actorId of ['player', 'companion'] as const) {
    const actor = next.actors[actorId]
    if (state.actors[actorId].status !== 'free') continue
    const contact =
      nextTick > OPENING_GRACE_TICKS &&
      (coordinatesEqual(actor.position, pursuerEnd) ||
        crossed(starts[actorId], actor.position, starts.pursuer, pursuerEnd))
    if (contact) {
      actor.status = 'captured'
      actor.rescueDeadlineTick = nextTick + DIFFICULTY_CONFIG[state.difficulty].rescueTicks
      newlyCaptured.add(actorId)
      next.decisionEpoch += 1
      tickEvents.push({ tick: nextTick, type: 'capture', actorId })
    }
  }

  for (const capturedId of ['player', 'companion'] as const) {
    const rescuerId = capturedId === 'player' ? 'companion' : 'player'
    const wasCaptured = state.actors[capturedId].status === 'captured'
    const captured = next.actors[capturedId]
    const rescuer = next.actors[rescuerId]
    if (
      wasCaptured &&
      !newlyCaptured.has(capturedId) &&
      captured.status === 'captured' &&
      rescuer.status === 'free' &&
      coordinatesEqual(captured.position, rescuer.position) &&
      nextTick <= (captured.rescueDeadlineTick ?? -1)
    ) {
      captured.status = 'free'
      delete captured.rescueDeadlineTick
      next.decisionEpoch += 1
      tickEvents.push({ tick: nextTick, type: 'rescue', actorId: capturedId })
    }
  }

  const deadlineLoss = (['player', 'companion'] as const).some((actorId) => {
    const actor = next.actors[actorId]
    return actor.status === 'captured' && nextTick >= (actor.rescueDeadlineTick ?? 0)
  })

  for (const actorId of ['player', 'companion'] as const) {
    const actor = next.actors[actorId]
    if (actor.status !== 'free') continue
    for (const objective of next.objectives) {
      if (!objective.collected && coordinatesEqual(actor.position, objective.position)) {
        objective.collected = true
        next.decisionEpoch += 1
        tickEvents.push({ tick: nextTick, type: 'core-collected', actorId, detail: objective.id })
      }
    }
  }
  next.exit.enabled =
    next.objectives.every((objective) => objective.collected) && nextTick >= MIN_RUN_TICKS

  const bothCaptured =
    next.actors.player.status === 'captured' && next.actors.companion.status === 'captured'
  if (bothCaptured || deadlineLoss) {
    next.phase = 'loss'
    next.terminal = {
      outcome: 'loss',
      reason: bothCaptured ? 'both-captured' : 'rescue-deadline',
      tick: nextTick,
    }
    tickEvents.push({ tick: nextTick, type: 'loss', detail: next.terminal.reason })
  } else if (
    next.exit.enabled &&
    next.actors.player.status === 'free' &&
    next.actors.companion.status === 'free' &&
    coordinatesEqual(next.actors.player.position, next.exit.position) &&
    coordinatesEqual(next.actors.companion.position, next.exit.position)
  ) {
    next.phase = 'win'
    next.terminal = { outcome: 'win', reason: 'joint-exit', tick: nextTick }
    tickEvents.push({ tick: nextTick, type: 'win' })
  } else if (nextTick >= RUN_CAP_TICKS) {
    next.phase = 'timeout'
    next.terminal = { outcome: 'timeout', reason: 'run-cap', tick: nextTick }
    tickEvents.push({ tick: nextTick, type: 'timeout' })
  }
  if (next.phase !== 'running') next.decisionEpoch += 1
  next.tick = nextTick
  next.eventLog.push(...tickEvents)
  return next
}

export function rescueTicksRemaining(actor: ShadowActor, currentTick: number): number | null {
  if (actor.status !== 'captured' || actor.rescueDeadlineTick === undefined) return null
  return Math.max(0, actor.rescueDeadlineTick - currentTick)
}
