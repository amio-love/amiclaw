import { describe, expect, it } from 'vitest'
import { TriggerBus } from './trigger-bus'

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('TriggerBus', () => {
  it('serializes overlapping triggers, including session_start (r7 fix)', async () => {
    let active = 0
    let maxActive = 0
    let calls = 0
    const runner = async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      calls += 1
      await delay(20)
      active -= 1
    }
    const bus = new TriggerBus(runner, { debounceMs: 0, idleMs: 1_000_000 })
    bus.notify('session_start') // fires immediately
    bus.notify('session_start') // arrives while busy → held pending
    await delay(80)
    bus.dispose()
    expect(calls).toBe(2)
    expect(maxActive).toBe(1) // never two partner turns at once
  })

  it('debounces a flurry of player actions into one reaction', async () => {
    let calls = 0
    const bus = new TriggerBus(
      async () => {
        calls += 1
      },
      { debounceMs: 20, idleMs: 1_000_000 }
    )
    bus.notify('player_planted')
    bus.notify('player_planted')
    bus.notify('player_planted')
    await delay(60)
    bus.dispose()
    expect(calls).toBe(1)
  })
})
