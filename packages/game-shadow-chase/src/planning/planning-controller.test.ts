import { describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_PLANNING_SECONDS,
  PLANNING_STORAGE_KEY,
  createPlanningController,
  type PlanningScheduler,
  type PlanningStorage,
} from './planning-controller'

class ManualScheduler implements PlanningScheduler {
  nowMs = 0
  nextId = 1
  callbacks = new Map<number, (nowMs: number) => void>()

  now = () => this.nowMs
  request = (callback: (nowMs: number) => void) => {
    const id = this.nextId++
    this.callbacks.set(id, callback)
    return id
  }
  cancel = (id: number) => {
    this.callbacks.delete(id)
  }
  frame(deltaMs: number) {
    this.nowMs += deltaMs
    const callbacks = [...this.callbacks.values()]
    this.callbacks.clear()
    callbacks.forEach((callback) => callback(this.nowMs))
  }
}

function memoryStorage(initial?: string): PlanningStorage & { value: string | null } {
  return {
    value: initial ?? null,
    getItem(key) {
      return key === PLANNING_STORAGE_KEY ? this.value : null
    },
    setItem(key, value) {
      if (key === PLANNING_STORAGE_KEY) this.value = value
    },
  }
}

describe('visible-time planning controller', () => {
  it('defaults invalid persistence to 20 and stores only valid five-second steps', () => {
    for (const invalid of [undefined, '0', '7', '20.5', '65', 'oops']) {
      const controller = createPlanningController({ storage: memoryStorage(invalid) })
      expect(controller.getSnapshot().selectedSeconds).toBe(DEFAULT_PLANNING_SECONDS)
      controller.destroy()
    }
    const storage = memoryStorage('5')
    const controller = createPlanningController({ storage })
    expect(controller.getSnapshot().selectedSeconds).toBe(5)
    controller.setDuration(60)
    expect(storage.value).toBe('60')
  })

  it('uses total visible duration when adjusted during planning', () => {
    const scheduler = new ManualScheduler()
    const controller = createPlanningController({ scheduler, storage: memoryStorage('20') })
    controller.begin(vi.fn())
    scheduler.frame(8_000)
    controller.setDuration(30)
    expect(controller.getSnapshot().remainingSeconds).toBe(22)
  })

  it('pauses while hidden with no catch-up and resumes from a fresh baseline', () => {
    const scheduler = new ManualScheduler()
    const controller = createPlanningController({ scheduler, storage: memoryStorage('20') })
    controller.begin(vi.fn())
    scheduler.frame(5_000)
    controller.setHidden(true)
    const before = controller.getSnapshot().remainingSeconds
    scheduler.frame(60_000)
    expect(controller.getSnapshot().remainingSeconds).toBe(before)
    controller.setHidden(false)
    scheduler.frame(1_000)
    expect(controller.getSnapshot().remainingSeconds).toBe(before - 1)
  })

  it('exposes the final three and completes exactly once across racing triggers', () => {
    const scheduler = new ManualScheduler()
    const completed = vi.fn()
    const controller = createPlanningController({ scheduler, storage: memoryStorage('5') })
    controller.begin(completed)
    scheduler.frame(2_000)
    expect(controller.getSnapshot().urgentSecond).toBe(3)
    scheduler.frame(1_000)
    expect(controller.getSnapshot().urgentSecond).toBe(2)
    scheduler.frame(1_000)
    expect(controller.getSnapshot().urgentSecond).toBe(1)
    controller.startNow()
    scheduler.frame(1_000)
    controller.startNow()
    expect(completed).toHaveBeenCalledTimes(1)
    expect(controller.getSnapshot().status).toBe('complete')
  })

  it('completes on the next controller turn when duration drops below elapsed', () => {
    const scheduler = new ManualScheduler()
    const completed = vi.fn()
    const controller = createPlanningController({ scheduler, storage: memoryStorage('20') })
    controller.begin(completed)
    scheduler.frame(8_000)
    controller.setDuration(5)
    expect(completed).not.toHaveBeenCalled()
    scheduler.frame(0)
    expect(completed).toHaveBeenCalledTimes(1)
  })
})
