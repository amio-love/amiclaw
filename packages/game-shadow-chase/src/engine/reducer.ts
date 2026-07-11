import { DIFFICULTY_CONFIG, MIN_RUN_TICKS, RUN_CAP_TICKS, isSafeTick } from './config'
import { companionNextStep } from './companion-policy'
import { validateModelProposal } from './intent-legality'
import { getMap } from './maps'
import { nextStepOnShortestPath, shortestPath } from './pathfinding'
import { pursuerStepPath, refreshPursuerDecision } from './pursuer-policy'
import { coordinatesEqual, isInsideMap, isWalkable, moved } from './rules'
import type {
  Coordinate,
  EngineEvent,
  QueuedAction,
  PlayerInputRejectionReason,
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
  pursuer(state: SimulationState, nextTick: number): Coordinate | readonly Coordinate[]
}

const DEFAULT_POLICIES: ReducerPolicies = {
  companion: companionNextStep,
  pursuer: pursuerStepPath,
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

  let playerQueued: QueuedAction | undefined
  let swapRequested = false
  for (const queued of actions) {
    const action = queued.action
    if ((action.type === 'player-move' || action.type === 'player-target') && !playerQueued) {
      playerQueued = queued
    }
    if (action.type === 'swap' && !swapRequested) swapRequested = true
    if (action.type === 'player-input-rejected') {
      tickEvents.push({
        tick: nextTick,
        type: 'move-rejected',
        actorId: 'player',
        actionSequence: queued.sequence,
        reason: action.reason,
      })
    }
    if (action.type === 'companion-command') {
      const target = next.objectives.find(
        (objective) => objective.id === action.targetObjectiveId && !objective.collected
      )
      next.command = {
        intent: action.command,
        ...(action.command === 'scout' && target ? { targetObjectiveId: target.id } : {}),
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
  let playerAttemptSequence: number | undefined
  let playerRejection: PlayerInputRejectionReason | undefined
  let pathOwnedAttempt = false
  const reject = (reason: PlayerInputRejectionReason, sequence: number) => {
    playerRejection = reason
    playerAttemptSequence = sequence
  }

  if (playerQueued?.action.type === 'player-move') {
    next.playerNavigation = undefined
    playerAttemptSequence = playerQueued.sequence
    if (state.actors.player.status === 'captured') {
      reject('captured', playerQueued.sequence)
    } else {
      const candidate = moved(starts.player, playerQueued.action.direction)
      if (!isInsideMap(map, candidate)) reject('edge', playerQueued.sequence)
      else if (!isWalkable(map, candidate)) reject('wall', playerQueued.sequence)
      else playerEnd = candidate
    }
  } else {
    if (playerQueued?.action.type === 'player-target') {
      const target = playerQueued.action.target
      playerAttemptSequence = playerQueued.sequence
      pathOwnedAttempt = true
      if (!isInsideMap(map, target)) {
        next.playerNavigation = undefined
        reject('edge', playerQueued.sequence)
      } else if (!isWalkable(map, target)) {
        next.playerNavigation = undefined
        reject('wall', playerQueued.sequence)
      } else if (!shortestPath(map, starts.player, target)) {
        next.playerNavigation = undefined
        reject('unreachable', playerQueued.sequence)
      } else if (coordinatesEqual(starts.player, target)) {
        next.playerNavigation = undefined
      } else {
        next.playerNavigation = {
          target: { ...target },
          actionSequence: playerQueued.sequence,
        }
      }
    }

    const navigation = next.playerNavigation
    if (!playerRejection && navigation) {
      playerAttemptSequence = navigation.actionSequence
      pathOwnedAttempt = true
      if (state.actors.player.status === 'captured') {
        next.playerNavigation = undefined
        reject('captured', navigation.actionSequence)
      } else {
        const candidate = nextStepOnShortestPath(map, starts.player, navigation.target)
        if (!candidate) {
          next.playerNavigation = undefined
          reject('unreachable', navigation.actionSequence)
        } else {
          playerEnd = candidate
        }
      }
    }
  }
  let companionEnd = policies.companion(next)
  const pursuerResult = policies.pursuer(next, nextTick)
  const plannedPursuerPath: Coordinate[] = Array.isArray(pursuerResult)
    ? [...pursuerResult]
    : [pursuerResult as Coordinate]
  if (plannedPursuerPath.length === 0) throw new Error('Pursuer path cannot be empty')
  if (next.actors.pursuer.target !== state.actors.pursuer.target) {
    next.decisionEpoch += 1
  }

  const canSwap =
    swapRequested &&
    state.actors.player.status === 'free' &&
    state.actors.companion.status === 'free' &&
    state.swapCharges > 0
  if (canSwap) {
    next.playerNavigation = undefined
    playerEnd = starts.companion
    companionEnd = starts.player
    next.swapCharges -= 1
    tickEvents.push({ tick: nextTick, type: 'swap' })
  } else {
    if (swapRequested) {
      next.playerNavigation = undefined
      tickEvents.push({ tick: nextTick, type: 'swap-rejected' })
    }
    const bothFree =
      state.actors.player.status === 'free' && state.actors.companion.status === 'free'
    const sameOrdinaryTile =
      bothFree &&
      coordinatesEqual(playerEnd, companionEnd) &&
      !(next.exit.enabled && coordinatesEqual(playerEnd, next.exit.position))
    const crossing = bothFree && crossed(starts.player, playerEnd, starts.companion, companionEnd)
    if (sameOrdinaryTile || crossing) {
      if (!coordinatesEqual(playerEnd, starts.player) && playerAttemptSequence !== undefined) {
        playerRejection = 'companion'
      }
      playerEnd = starts.player
      companionEnd = starts.companion
    }
  }

  const pursuerContactIndex = (
    actorStart: Coordinate,
    actorEnd: Coordinate,
    path: readonly Coordinate[]
  ): number => {
    let pursuerStart = starts.pursuer
    for (let index = 0; index < path.length; index += 1) {
      const pursuerStep = path[index]
      const actorStepStart = index === 0 ? actorStart : actorEnd
      if (
        coordinatesEqual(actorEnd, pursuerStep) ||
        crossed(actorStepStart, actorEnd, pursuerStart, pursuerStep)
      ) {
        return index
      }
      pursuerStart = pursuerStep
    }
    return -1
  }
  const playerContactIndex =
    state.actors.player.status === 'free'
      ? pursuerContactIndex(starts.player, playerEnd, plannedPursuerPath)
      : -1
  const effectivePursuerPath =
    playerContactIndex >= 0
      ? plannedPursuerPath.slice(0, playerContactIndex + 1)
      : plannedPursuerPath
  const pursuerEnd = effectivePursuerPath[effectivePursuerPath.length - 1]

  next.actors.player.position = playerEnd
  next.actors.companion.position = companionEnd
  next.actors.pursuer.position = pursuerEnd
  for (const actorId of ['player', 'companion'] as const) {
    if (!coordinatesEqual(starts[actorId], next.actors[actorId].position)) {
      tickEvents.push({ tick: nextTick, type: 'move', actorId })
    }
  }
  if (playerRejection && playerAttemptSequence !== undefined) {
    tickEvents.push({
      tick: nextTick,
      type: 'move-rejected',
      actorId: 'player',
      actionSequence: playerAttemptSequence,
      reason: playerRejection,
    })
  }
  if (
    pathOwnedAttempt &&
    next.playerNavigation &&
    coordinatesEqual(next.actors.player.position, next.playerNavigation.target)
  ) {
    next.playerNavigation = undefined
  }

  const newlyCaptured = new Set<'player' | 'companion'>()
  for (const actorId of ['player', 'companion'] as const) {
    const actor = next.actors[actorId]
    if (state.actors[actorId].status !== 'free') continue
    const contact = pursuerContactIndex(starts[actorId], actor.position, effectivePursuerPath) >= 0
    if (contact) {
      actor.status = 'captured'
      actor.rescueDeadlineTick = nextTick + DIFFICULTY_CONFIG[state.difficulty].rescueTicks
      newlyCaptured.add(actorId)
      if (actorId === 'player') next.playerNavigation = undefined
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

  const targetBeforeCommitRefresh = next.actors.pursuer.target
  refreshPursuerDecision(next)
  if (next.actors.pursuer.target !== targetBeforeCommitRefresh) {
    next.decisionEpoch += 1
  }

  const deadlineLoss = (['player', 'companion'] as const).some((actorId) => {
    const actor = next.actors[actorId]
    return actor.status === 'captured' && nextTick >= (actor.rescueDeadlineTick ?? 0)
  })

  const player = next.actors.player
  if (player.status === 'free') {
    for (const objective of next.objectives) {
      if (!objective.collected && coordinatesEqual(player.position, objective.position)) {
        objective.collected = true
        next.swapCharges += 1
        next.decisionEpoch += 1
        tickEvents.push({
          tick: nextTick,
          type: 'core-collected',
          actorId: 'player',
          detail: objective.id,
        })
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
  if (next.phase !== 'running') next.playerNavigation = undefined
  next.tick = nextTick
  next.eventLog.push(...tickEvents)
  return next
}

export function rescueTicksRemaining(actor: ShadowActor, currentTick: number): number | null {
  if (actor.status !== 'captured' || actor.rescueDeadlineTick === undefined) return null
  return Math.max(0, actor.rescueDeadlineTick - currentTick)
}
