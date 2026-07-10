import { TICK_MS } from '../engine/config'
import { advance } from '../engine/reducer'
import { createRunningState } from '../engine/rules'
import type {
  Difficulty,
  Direction,
  EngineAction,
  QueuedAction,
  SimulationState,
} from '../engine/types'
import { buildIntentRequest } from '../model/intent-contract'
import {
  createIntentCoordinator,
  fetchIntentFromEndpoint,
  type IntentCoordinator,
  type IntentFetch,
} from '../model/intent-client'

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
  destroy(): void
  dispatch(action: EngineAction): void
  setHidden(hidden: boolean): void
  setHeldKey(code: string, pressed: boolean): void
  clearInput(): void
  getInputSnapshot(): { heldKeys: string[] }
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
  const listeners = new Set<() => void>()
  const heldKeys = new Map<string, number>()
  let heldSequence = 0

  const notify = () => listeners.forEach((listener) => listener())
  const queue = (action: EngineAction) => {
    if (destroyed || state.phase !== 'running') return
    actionQueue.push({ action, sequence: ++sequence, applyAtTick: state.tick + 1 })
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
        queue({
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
      const direction = heldDirection()
      if (direction) queue({ type: 'player-move', direction })
      const previousEpoch = state.decisionEpoch
      const nextTick = state.tick + 1
      const actions = actionQueue.filter((action) => action.applyAtTick === nextTick)
      actionQueue = actionQueue.filter((action) => action.applyAtTick > nextTick)
      state = advance(state, actions)
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
    heldKeys.clear()
  }

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    start() {
      if (destroyed || started) return
      started = true
      lastFrameMs = scheduler.now()
      accumulatorMs = 0
      requestIntent()
      scheduleFrame()
    },
    restart() {
      if (destroyed) return
      intentCoordinator?.abortCurrent()
      cancelFrame()
      clearInput()
      actionQueue = []
      generation += 1
      state = createRunningState(mapId, difficulty, initialSeed + generation - 1)
      started = true
      lastFrameMs = scheduler.now()
      accumulatorMs = 0
      notify()
      requestIntent()
      scheduleFrame()
    },
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
        actionQueue = []
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
        if (!heldKeys.has(code)) heldKeys.set(code, ++heldSequence)
      } else {
        heldKeys.delete(code)
      }
    },
    clearInput,
    getInputSnapshot: () => ({ heldKeys: [...heldKeys.keys()].sort() }),
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
