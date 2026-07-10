export const PLANNING_STORAGE_KEY = 'shadow-chase:planning-seconds:v1'
export const DEFAULT_PLANNING_SECONDS = 20
export const MIN_PLANNING_SECONDS = 5
export const MAX_PLANNING_SECONDS = 60
export const PLANNING_STEP_SECONDS = 5

export interface PlanningScheduler {
  now(): number
  request(callback: (nowMs: number) => void): number
  cancel(id: number): void
}

export interface PlanningStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface PlanningSnapshot {
  status: 'idle' | 'planning' | 'complete'
  selectedSeconds: number
  remainingSeconds: number
  urgentSecond: 1 | 2 | 3 | null
  hidden: boolean
}

export interface PlanningController {
  getSnapshot(): PlanningSnapshot
  subscribe(listener: () => void): () => void
  begin(onComplete: () => void): void
  setDuration(seconds: number): void
  adjust(deltaSeconds: number): void
  setHidden(hidden: boolean): void
  startNow(): void
  reset(): void
  destroy(): void
}

const browserScheduler: PlanningScheduler = {
  now: () => performance.now(),
  request: (callback) => requestAnimationFrame(callback),
  cancel: (id) => cancelAnimationFrame(id),
}

function browserStorage(): PlanningStorage | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

export function isPlanningDuration(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    Number(value) >= MIN_PLANNING_SECONDS &&
    Number(value) <= MAX_PLANNING_SECONDS &&
    Number(value) % PLANNING_STEP_SECONDS === 0
  )
}

export function readPlanningDuration(storage?: PlanningStorage): number {
  if (!storage) return DEFAULT_PLANNING_SECONDS
  let raw: string | null
  try {
    raw = storage.getItem(PLANNING_STORAGE_KEY)
  } catch {
    return DEFAULT_PLANNING_SECONDS
  }
  if (raw === null || !/^\d+$/.test(raw)) return DEFAULT_PLANNING_SECONDS
  const parsed = Number(raw)
  return isPlanningDuration(parsed) ? parsed : DEFAULT_PLANNING_SECONDS
}

export function createPlanningController(options?: {
  scheduler?: PlanningScheduler
  storage?: PlanningStorage
}): PlanningController {
  const scheduler = options?.scheduler ?? browserScheduler
  const storage = options?.storage ?? browserStorage()
  let selectedSeconds = readPlanningDuration(storage)
  let snapshot: PlanningSnapshot = {
    status: 'idle',
    selectedSeconds,
    remainingSeconds: selectedSeconds,
    urgentSecond: null,
    hidden: false,
  }
  let accumulatedVisibleMs = 0
  let visibleBaselineMs = scheduler.now()
  let frameId: number | undefined
  let completion: (() => void) | undefined
  let destroyed = false
  const listeners = new Set<() => void>()

  const publish = (next: PlanningSnapshot) => {
    if (
      snapshot.status === next.status &&
      snapshot.selectedSeconds === next.selectedSeconds &&
      snapshot.remainingSeconds === next.remainingSeconds &&
      snapshot.urgentSecond === next.urgentSecond &&
      snapshot.hidden === next.hidden
    ) {
      return
    }
    snapshot = next
    listeners.forEach((listener) => listener())
  }

  const visibleElapsed = (nowMs: number) =>
    accumulatedVisibleMs +
    (snapshot.status === 'planning' && !snapshot.hidden
      ? Math.max(0, nowMs - visibleBaselineMs)
      : 0)

  const refresh = (nowMs: number) => {
    const remainingMs = Math.max(0, selectedSeconds * 1000 - visibleElapsed(nowMs))
    const remainingSeconds = Math.ceil(remainingMs / 1000)
    const urgentSecond =
      remainingSeconds >= 1 && remainingSeconds <= 3 ? (remainingSeconds as 1 | 2 | 3) : null
    publish({ ...snapshot, selectedSeconds, remainingSeconds, urgentSecond })
    return remainingMs
  }

  const cancelFrame = () => {
    if (frameId === undefined) return
    scheduler.cancel(frameId)
    frameId = undefined
  }

  const complete = () => {
    if (destroyed || snapshot.status !== 'planning') return
    cancelFrame()
    accumulatedVisibleMs = Math.min(accumulatedVisibleMs, selectedSeconds * 1000)
    const callback = completion
    completion = undefined
    publish({
      status: 'complete',
      selectedSeconds,
      remainingSeconds: 0,
      urgentSecond: null,
      hidden: snapshot.hidden,
    })
    callback?.()
  }

  const schedule = () => {
    if (destroyed || frameId !== undefined || snapshot.status !== 'planning' || snapshot.hidden) {
      return
    }
    frameId = scheduler.request(onFrame)
  }

  function onFrame(nowMs: number) {
    frameId = undefined
    if (destroyed || snapshot.status !== 'planning' || snapshot.hidden) return
    if (refresh(nowMs) <= 0) complete()
    else schedule()
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    begin(onComplete) {
      if (destroyed) return
      cancelFrame()
      accumulatedVisibleMs = 0
      visibleBaselineMs = scheduler.now()
      completion = onComplete
      publish({
        status: 'planning',
        selectedSeconds,
        remainingSeconds: selectedSeconds,
        urgentSecond: null,
        hidden: false,
      })
      schedule()
    },
    setDuration(seconds) {
      if (destroyed || !isPlanningDuration(seconds)) return
      selectedSeconds = seconds
      try {
        storage?.setItem(PLANNING_STORAGE_KEY, String(seconds))
      } catch {
        // Persistence failure must not block planning.
      }
      if (snapshot.status === 'planning') refresh(scheduler.now())
      else publish({ ...snapshot, selectedSeconds: seconds, remainingSeconds: seconds })
    },
    adjust(deltaSeconds) {
      this.setDuration(selectedSeconds + deltaSeconds)
    },
    setHidden(hidden) {
      if (destroyed || snapshot.hidden === hidden) return
      const nowMs = scheduler.now()
      if (hidden) {
        if (snapshot.status === 'planning') {
          accumulatedVisibleMs = visibleElapsed(nowMs)
        }
        cancelFrame()
        publish({ ...snapshot, hidden: true })
        if (snapshot.status === 'planning') refresh(nowMs)
      } else {
        visibleBaselineMs = nowMs
        publish({ ...snapshot, hidden: false })
        schedule()
      }
    },
    startNow: complete,
    reset() {
      if (destroyed) return
      cancelFrame()
      completion = undefined
      accumulatedVisibleMs = 0
      publish({
        status: 'idle',
        selectedSeconds,
        remainingSeconds: selectedSeconds,
        urgentSecond: null,
        hidden: false,
      })
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      cancelFrame()
      completion = undefined
      listeners.clear()
    },
  }
}
