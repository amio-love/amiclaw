import { describe, expect, it } from 'vitest'

import { TICK_MS } from '../engine/config'
import { createGameStore, type FrameScheduler } from './game-store'

class ManualScheduler implements FrameScheduler {
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

describe('fixed-step external store', () => {
  it('caps visible catch-up at four ticks and drops excess', () => {
    const scheduler = new ManualScheduler()
    const store = createGameStore({ scheduler, seed: 5, mapId: 'courtyard' })
    store.start()
    scheduler.frame(TICK_MS * 10)
    expect(store.getSnapshot().tick).toBe(4)
    expect(store.getDiagnostics().droppedCatchUpFrames).toBe(1)
  })

  it('pauses hidden with zero catch-up and clears input', () => {
    const scheduler = new ManualScheduler()
    const store = createGameStore({ scheduler, seed: 5, mapId: 'courtyard' })
    store.start()
    store.setHeldKey('KeyD', true)
    store.setHidden(true)
    scheduler.frame(TICK_MS * 20)
    expect(store.getSnapshot().tick).toBe(0)
    expect(store.getSnapshot().decisionEpoch).toBe(1)
    expect(store.getInputSnapshot().heldKeys).toEqual([])
    store.setHidden(false)
    scheduler.frame(TICK_MS)
    expect(store.getSnapshot().tick).toBe(1)
  })

  it('cleans up the single loop exactly once', () => {
    const scheduler = new ManualScheduler()
    const store = createGameStore({ scheduler, seed: 5, mapId: 'courtyard' })
    store.start()
    expect(scheduler.callbacks.size).toBe(1)
    store.destroy()
    store.destroy()
    expect(scheduler.callbacks.size).toBe(0)
    expect(store.getDiagnostics().destroyCount).toBe(1)
  })

  it('cancels opposing held keys and keeps the most recent perpendicular key', () => {
    const scheduler = new ManualScheduler()
    const store = createGameStore({ scheduler, seed: 5, mapId: 'courtyard', fetchIntent: null })
    store.start()
    const start = store.getSnapshot().actors.player.position
    store.setHeldKey('KeyA', true)
    store.setHeldKey('KeyD', true)
    store.setHeldKey('KeyD', true)
    scheduler.frame(TICK_MS)
    expect(store.getSnapshot().actors.player.position).toEqual(start)
    store.setHeldKey('KeyW', true)
    scheduler.frame(TICK_MS)
    expect(store.getSnapshot().actors.player.position).toEqual({ x: 1, y: 0 })
  })

  it('reaches a terminal state while the optional model request never resolves', () => {
    const scheduler = new ManualScheduler()
    const store = createGameStore({
      scheduler,
      seed: 5,
      mapId: 'courtyard',
      fetchIntent: () => new Promise(() => undefined),
    })
    store.start()
    let watchdog = 0
    while (store.getSnapshot().phase === 'running' && watchdog <= 1200) {
      scheduler.frame(TICK_MS)
      watchdog += 1
    }
    expect(watchdog).toBeLessThanOrEqual(1200)
    expect(store.getSnapshot().phase).not.toBe('running')
  })

  it('applies a companion command on the next visible tick', () => {
    const scheduler = new ManualScheduler()
    const store = createGameStore({ scheduler, seed: 5, mapId: 'courtyard', fetchIntent: null })
    store.start()
    store.dispatch({ type: 'companion-command', command: 'decoy' })
    scheduler.frame(TICK_MS)
    expect(store.getSnapshot().command.intent).toBe('decoy')
  })
})
