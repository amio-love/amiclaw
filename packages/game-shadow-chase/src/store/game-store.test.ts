import { describe, expect, it } from 'vitest'

import { TICK_MS } from '../engine/config'
import { replay } from '../engine/replay'
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

  it('preserves initial keydown steps before opposing held keys cancel', () => {
    const scheduler = new ManualScheduler()
    const store = createGameStore({ scheduler, seed: 5, mapId: 'courtyard', fetchIntent: null })
    store.start()
    store.setHeldKey('KeyA', true)
    store.setHeldKey('KeyD', true)
    store.setHeldKey('KeyD', true)
    scheduler.frame(TICK_MS)
    expect(store.getSnapshot().actors.player.position).toEqual({ x: 0, y: 1 })
    scheduler.frame(TICK_MS)
    expect(store.getSnapshot().actors.player.position).toEqual({ x: 0, y: 1 })
    scheduler.frame(TICK_MS)
    expect(store.getSnapshot().actors.player.position).toEqual({ x: 0, y: 1 })
    store.setHeldKey('KeyW', true)
    scheduler.frame(TICK_MS)
    expect(store.getSnapshot().actors.player.position).toEqual({ x: 0, y: 0 })
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
    store.dispatch({ type: 'companion-command', command: 'anchor' })
    scheduler.frame(TICK_MS)
    expect(store.getSnapshot().command.intent).toBe('anchor')
  })

  it('preserves rapid discrete movement FIFO across successive ticks', () => {
    const scheduler = new ManualScheduler()
    const store = createGameStore({ scheduler, seed: 5, mapId: 'crossroads', fetchIntent: null })
    store.start()
    store.dispatch({ type: 'player-move', direction: 'right' })
    store.dispatch({ type: 'player-move', direction: 'down' })
    store.dispatch({ type: 'player-move', direction: 'left' })
    scheduler.frame(TICK_MS)
    expect(store.getSnapshot().actors.player.position).toEqual({ x: 2, y: 1 })
    scheduler.frame(TICK_MS)
    expect(store.getSnapshot().actors.player.position).toEqual({ x: 2, y: 2 })
    scheduler.frame(TICK_MS)
    expect(store.getSnapshot().actors.player.position).toEqual({ x: 1, y: 2 })
  })

  it('reconciles immediate queue-full feedback into events and replay without eviction', () => {
    const scheduler = new ManualScheduler()
    const store = createGameStore({ scheduler, seed: 5, mapId: 'crossroads', fetchIntent: null })
    store.start()
    for (let index = 0; index < 9; index += 1) {
      store.dispatch({ type: 'player-move', direction: 'right' })
    }
    expect(store.getInputSnapshot().bufferedMoves).toHaveLength(8)
    const immediate = store.getInputFeedback()
    expect(immediate).toEqual({ tick: 1, actionSequence: 9, reason: 'queue-full' })
    expect(store.getSnapshot().eventLog).toHaveLength(0)

    scheduler.frame(TICK_MS)
    const authoritative = store
      .getSnapshot()
      .eventLog.find((event) => event.actionSequence === immediate?.actionSequence)
    expect(authoritative).toMatchObject({
      tick: 1,
      type: 'move-rejected',
      actorId: 'player',
      actionSequence: 9,
      reason: 'queue-full',
    })
    expect(store.getInputFeedback()).toBe(immediate)
    expect(store.getInputFeedback()).toEqual({
      tick: authoritative?.tick,
      actionSequence: authoritative?.actionSequence,
      reason: authoritative?.reason,
    })
    expect(store.getInputSnapshot().bufferedMoves).toHaveLength(7)

    for (let index = 1; index < 8; index += 1) scheduler.frame(TICK_MS)
    const record = store.getReplayRecord()
    expect(
      record.actions
        .filter((queued) => queued.action.type === 'player-move')
        .map((queued) => queued.sequence)
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(record.actions[0]).toMatchObject({
      applyAtTick: 1,
      sequence: 1,
      action: { type: 'player-move' },
    })
    expect(record.actions[1]).toEqual({
      applyAtTick: 1,
      sequence: 9,
      action: { type: 'player-input-rejected', reason: 'queue-full' },
    })
    expect(replay(record, store.getSnapshot().tick).eventLog).toContainEqual(authoritative)
  })

  it('keeps a tap target active until arrival and lets discrete input cancel it', () => {
    const scheduler = new ManualScheduler()
    const store = createGameStore({ scheduler, seed: 5, mapId: 'crossroads', fetchIntent: null })
    store.start()
    store.dispatch({ type: 'player-target', target: { x: 3, y: 1 } })
    scheduler.frame(TICK_MS)
    expect(store.getSnapshot().actors.player.position).toEqual({ x: 2, y: 1 })
    expect(store.getSnapshot().playerNavigation?.target).toEqual({ x: 3, y: 1 })
    scheduler.frame(TICK_MS)
    expect(store.getSnapshot().actors.player.position).toEqual({ x: 3, y: 1 })
    expect(store.getSnapshot().playerNavigation).toBeUndefined()

    store.dispatch({ type: 'player-target', target: { x: 3, y: 3 } })
    store.dispatch({ type: 'player-move', direction: 'left' })
    scheduler.frame(TICK_MS)
    expect(store.getSnapshot().playerNavigation).toBeUndefined()
  })

  it('prepares a restarted run without advancing until start is called', () => {
    const scheduler = new ManualScheduler()
    const store = createGameStore({ scheduler, seed: 5, mapId: 'courtyard', fetchIntent: null })
    store.start()
    scheduler.frame(TICK_MS)
    store.prepareNextRun()
    expect(store.getSnapshot().tick).toBe(0)
    expect(store.getDiagnostics().started).toBe(false)
    scheduler.frame(TICK_MS * 4)
    expect(store.getSnapshot().tick).toBe(0)
    store.start()
    scheduler.frame(TICK_MS)
    expect(store.getSnapshot().tick).toBe(1)
  })

  it('cancels an active tap path when hidden and resumes without it', () => {
    const scheduler = new ManualScheduler()
    const store = createGameStore({ scheduler, seed: 5, mapId: 'crossroads', fetchIntent: null })
    store.start()
    store.dispatch({ type: 'player-target', target: { x: 3, y: 1 } })
    scheduler.frame(TICK_MS)
    expect(store.getSnapshot().playerNavigation).toBeDefined()
    store.setHidden(true)
    expect(store.getSnapshot().playerNavigation).toBeUndefined()
    const hiddenPosition = store.getSnapshot().actors.player.position
    store.setHidden(false)
    scheduler.frame(TICK_MS)
    expect(store.getSnapshot().actors.player.position).toEqual(hiddenPosition)
  })
})
