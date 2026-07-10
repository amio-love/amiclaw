import { TICK_MS } from '../engine/config'
import { advance } from '../engine/reducer'
import { createRunningState } from '../engine/rules'
import type {
  Difficulty,
  Direction,
  EngineAction,
  QueuedAction,
  PlayerInputFeedback,
  ReplayRecord,
  SimulationState,
} from '../engine/types'
import { buildIntentRequest } from '../model/intent-contract'
import {
  createIntentCoordinator,
  fetchIntentFromEndpoint,
  type IntentCoordinator,
  type IntentFetch,
} from '../model/intent-client'
import { createInputController } from './input-controller'

export interface FrameScheduler {
  now(): number
  request(callback: (nowMs: number) => void): number
  cancel(id: number): void
}

export interface GameStore {
  getSnapshot(): SimulationState
  subscribe(listener: () => void): () => void
  start(): void
  restart(): void
  prepareNextRun(): void
  destroy(): void
  dispatch(action: EngineAction): void
  setHidden(hidden: boolean): void
  setHeldKey(code: string, pressed: boolean): void
  clearInput(): void
  getInputSnapshot(): { heldKeys: string[]; bufferedMoves: Direction[] }
  getInputFeedback(): PlayerInputFeedback | undefined
  getReplayRecord(): ReplayRecord
  getDiagnostics(): {
    droppedCatchUpFrames: number
    destroyCount: number
    generation: number
    started: boolean
    hidden: boolean
    frameScheduled: boolean
  }
}

const defaultScheduler: FrameScheduler = {
  now: () => performance.now(),
  request: (callback) => requestAnimationFrame(callback),
  cancel: (id) => cancelAnimationFrame(id),
}

const KEY_DIRECTIONS: Record<string, Direction> = {
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
}

export function createGameStore(options?: {
  scheduler?: FrameScheduler
  seed?: number
  mapId?: string
  difficulty?: Difficulty
  fetchIntent?: IntentFetch | null
}): GameStore {
  const scheduler = options?.scheduler ?? defaultScheduler
  const initialSeed = options?.seed ?? 20260710
  const mapId = options?.mapId ?? 'courtyard'
  const difficulty = options?.difficulty ?? 'standard'
  let state = createRunningState(mapId, difficulty, initialSeed)
  let started = false
  let hidden = false
  let destroyed = false
  let destroyCount = 0
  let generation = 1
  let sequence = 0
  let accumulatorMs = 0
  let lastFrameMs = scheduler.now()
  let frameId: number | undefined
  let droppedCatchUpFrames = 0
  let actionQueue: QueuedAction[] = []
  let replayActions: QueuedAction[] = []
  const inputController = createInputController()
  let inputFeedback: PlayerInputFeedback | undefined
  const listeners = new Set<() => void>()
  const heldKeys = new Map<string, number>()
  let heldSequence = 0

  const notify = () => listeners.forEach((listener) => listener())
  const queueAction = (action: EngineAction, actionSequence = ++sequence) => {
    if (destroyed || state.phase !== 'running') return
    actionQueue.push({ action, sequence: actionSequence, applyAtTick: state.tick + 1 })
  }

  const publishFeedback = (feedback: PlayerInputFeedback | undefined) => {
    inputFeedback = feedback
    state = { ...state }
  }

  const enqueueMove = (direction: Direction) => {
    if (destroyed || hidden || state.phase !== 'running') return
    const actionSequence = ++sequence
    actionQueue = actionQueue.filter((queued) => queued.action.type !== 'player-target')
    if (!inputController.enqueue({ direction, actionSequence })) {
      // Show saturation immediately, but stamp it with the deterministic tick
      // where the matching rejection action will enter the engine event stream.
      const feedback: PlayerInputFeedback = {
        tick: state.tick + 1,
        actionSequence,
        reason: 'queue-full',
      }
      queueAction({ type: 'player-input-rejected', reason: 'queue-full' }, actionSequence)
      publishFeedback(feedback)
      notify()
    }
  }

  const queue = (action: EngineAction) => {
    if (action.type === 'player-move') {
      enqueueMove(action.direction)
      return
    }
    if (action.type === 'player-target') {
      if (destroyed || hidden || state.phase !== 'running') return
      inputController.clear()
      actionQueue = actionQueue.filter(
        (queued) => queued.action.type !== 'player-move' && queued.action.type !== 'player-target'
      )
      queueAction(action)
      return
    }
    if (action.type === 'swap') clearInput()
    queueAction(action)
  }

  let intentCoordinator: IntentCoordinator | undefined
  if (options?.fetchIntent !== null) {
    intentCoordinator = createIntentCoordinator({
      fetchIntent: options?.fetchIntent ?? fetchIntentFromEndpoint,
      onAccepted(response, context) {
        if (
          destroyed ||
          generation !== context.generation ||
          state.runId !== context.runId ||
          state.decisionEpoch !== context.decisionEpoch ||
          state.phase !== 'running'
        ) {
          return
        }
        queueAction({
          type: 'accept-model-proposal',
          requestId: response.requestId,
          runId: response.runId,
          decisionEpoch: response.decisionEpoch,
          proposal: response.proposal,
          leaseTicks: response.leaseTicks,
        })
      },
    })
  }

  const requestIntent = () => {
    if (!intentCoordinator || hidden || state.phase !== 'running') return
    intentCoordinator.request(buildIntentRequest(state), {
      generation,
      runId: state.runId,
      decisionEpoch: state.decisionEpoch,
    })
  }

  const heldDirection = (): Direction | null => {
    const directions = [...heldKeys.entries()]
      .map(([code, order]) => ({ direction: KEY_DIRECTIONS[code], order }))
      .filter((entry): entry is { direction: Direction; order: number } => Boolean(entry.direction))
    const hasLeft = directions.some((entry) => entry.direction === 'left')
    const hasRight = directions.some((entry) => entry.direction === 'right')
    const hasUp = directions.some((entry) => entry.direction === 'up')
    const hasDown = directions.some((entry) => entry.direction === 'down')
    const valid = directions.filter((entry) => {
      if ((entry.direction === 'left' || entry.direction === 'right') && hasLeft && hasRight)
        return false
      if ((entry.direction === 'up' || entry.direction === 'down') && hasUp && hasDown) return false
      return true
    })
    valid.sort((left, right) => right.order - left.order)
    return valid[0]?.direction ?? null
  }

  const cancelFrame = () => {
    if (frameId === undefined) return
    scheduler.cancel(frameId)
    frameId = undefined
  }

  const scheduleFrame = () => {
    if (frameId !== undefined || destroyed || hidden || !started || state.phase !== 'running')
      return
    frameId = scheduler.request(onFrame)
  }

  const onFrame = (nowMs: number) => {
    frameId = undefined
    if (destroyed || hidden || !started || state.phase !== 'running') return
    const delta = Math.max(0, nowMs - lastFrameMs)
    lastFrameMs = nowMs
    accumulatorMs += delta
    const availableTicks = Math.floor(accumulatorMs / TICK_MS)
    const ticksToRun = Math.min(4, availableTicks)
    if (availableTicks > 4) {
      droppedCatchUpFrames += 1
      accumulatorMs = 0
    } else {
      accumulatorMs -= ticksToRun * TICK_MS
    }
    for (let index = 0; index < ticksToRun && state.phase === 'running'; index += 1) {
      const bufferedMove = inputController.take()
      if (bufferedMove) {
        actionQueue.push({
          action: { type: 'player-move', direction: bufferedMove.direction },
          sequence: bufferedMove.actionSequence,
          applyAtTick: state.tick + 1,
        })
      } else if (!state.playerNavigation) {
        const direction = heldDirection()
        if (direction) {
          actionQueue.push({
            action: { type: 'player-move', direction },
            sequence: ++sequence,
            applyAtTick: state.tick + 1,
          })
        }
      }
      const previousEpoch = state.decisionEpoch
      const nextTick = state.tick + 1
      const actions = actionQueue.filter((action) => action.applyAtTick === nextTick)
      actionQueue = actionQueue.filter((action) => action.applyAtTick > nextTick)
      replayActions.push(...structuredClone(actions))
      state = advance(state, actions)
      const tickEvents = state.eventLog.filter((event) => event.tick === state.tick)
      const rejected = tickEvents
        .filter(
          (event) =>
            event.type === 'move-rejected' &&
            event.reason !== undefined &&
            event.actionSequence !== undefined
        )
        .sort((left, right) => right.actionSequence! - left.actionSequence!)[0]
      if (rejected?.reason && rejected.actionSequence !== undefined) {
        const reconciledFeedback: PlayerInputFeedback = {
          tick: rejected.tick,
          actionSequence: rejected.actionSequence,
          reason: rejected.reason,
        }
        if (
          inputFeedback?.tick !== reconciledFeedback.tick ||
          inputFeedback.actionSequence !== reconciledFeedback.actionSequence ||
          inputFeedback.reason !== reconciledFeedback.reason
        ) {
          publishFeedback(reconciledFeedback)
        }
      } else if (tickEvents.some((event) => event.type === 'move' && event.actorId === 'player')) {
        publishFeedback(undefined)
      }
      if (tickEvents.some((event) => event.type === 'capture' && event.actorId === 'player')) {
        clearInput()
      }
      notify()
      if (state.phase !== 'running') {
        intentCoordinator?.abortCurrent()
        clearInput()
      } else if (state.decisionEpoch !== previousEpoch) {
        requestIntent()
      }
    }
    scheduleFrame()
  }

  const clearInput = () => {
    const changed =
      heldKeys.size > 0 || inputController.snapshot().length > 0 || Boolean(state.playerNavigation)
    heldKeys.clear()
    inputController.clear()
    actionQueue = actionQueue.filter(
      (queued) => queued.action.type !== 'player-move' && queued.action.type !== 'player-target'
    )
    if (state.playerNavigation) {
      const next = { ...state }
      delete next.playerNavigation
      state = next
    }
    if (changed && !destroyed) notify()
  }

  const prepareNextRun = () => {
    if (destroyed) return
    intentCoordinator?.abortCurrent()
    cancelFrame()
    clearInput()
    actionQueue = []
    replayActions = []
    inputFeedback = undefined
    generation += 1
    state = createRunningState(mapId, difficulty, initialSeed + generation - 1)
    started = false
    hidden = false
    accumulatorMs = 0
    lastFrameMs = scheduler.now()
    notify()
  }

  const startRun = () => {
    if (destroyed || started) return
    started = true
    lastFrameMs = scheduler.now()
    accumulatorMs = 0
    requestIntent()
    scheduleFrame()
  }

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    start: startRun,
    restart() {
      prepareNextRun()
      startRun()
    },
    prepareNextRun,
    destroy() {
      if (destroyed) return
      destroyed = true
      destroyCount += 1
      cancelFrame()
      clearInput()
      actionQueue = []
      intentCoordinator?.dispose()
      listeners.clear()
    },
    dispatch: queue,
    setHidden(value) {
      if (destroyed || hidden === value) return
      hidden = value
      if (hidden) {
        cancelFrame()
        accumulatorMs = 0
        actionQueue = actionQueue.filter((queued) => queued.action.type === 'player-input-rejected')
        clearInput()
        intentCoordinator?.abortCurrent()
        if (state.phase === 'running') {
          state = {
            ...state,
            decisionEpoch: state.decisionEpoch + 1,
            activeModelLease: undefined,
          }
          notify()
        }
      } else {
        lastFrameMs = scheduler.now()
        accumulatorMs = 0
        requestIntent()
        scheduleFrame()
      }
    },
    setHeldKey(code, pressed) {
      if (!(code in KEY_DIRECTIONS) || destroyed || hidden) return
      if (pressed) {
        if (!heldKeys.has(code)) {
          heldKeys.set(code, ++heldSequence)
          enqueueMove(KEY_DIRECTIONS[code])
        }
      } else {
        heldKeys.delete(code)
      }
    },
    clearInput,
    getInputSnapshot: () => ({
      heldKeys: [...heldKeys.keys()].sort(),
      bufferedMoves: inputController.snapshot().map((move) => move.direction),
    }),
    getInputFeedback: () => inputFeedback,
    getReplayRecord: () => ({
      schemaVersion: 1,
      seed: state.seed,
      mapId: state.mapId,
      difficulty: state.difficulty,
      actions: structuredClone(replayActions).sort(
        (left, right) => left.applyAtTick - right.applyAtTick || left.sequence - right.sequence
      ),
    }),
    getDiagnostics: () => ({
      droppedCatchUpFrames,
      destroyCount,
      generation,
      started,
      hidden,
      frameScheduled: frameId !== undefined,
    }),
  }
}
