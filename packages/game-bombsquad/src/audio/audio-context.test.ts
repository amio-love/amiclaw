import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// jsdom has no Web Audio API, so the master-gain tests run against a minimal
// AudioContext stub that records the one behaviour they assert on: the gain
// value of the node `getMasterGain` creates and `setMasterMuted` drives.
class FakeGainNode {
  gain = { value: 1 }
  connect = vi.fn()
}

class FakeAudioContext {
  state = 'running'
  destination = {}
  resume = vi.fn()
  createGain = vi.fn(() => new FakeGainNode())
}

describe('audio-context master gain', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('AudioContext', FakeAudioContext)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('getMasterGain returns one shared, connected node', async () => {
    const { getMasterGain } = await import('./audio-context')
    const first = getMasterGain()
    const second = getMasterGain()
    expect(first).not.toBeNull()
    expect(first).toBe(second)
    expect((first as unknown as FakeGainNode).connect).toHaveBeenCalledOnce()
  })

  it('master gain starts unmuted (gain 1) by default', async () => {
    const { getMasterGain } = await import('./audio-context')
    const gain = getMasterGain() as unknown as FakeGainNode
    expect(gain.gain.value).toBe(1)
  })

  it('setMasterMuted drives the live master gain node', async () => {
    const { getMasterGain, setMasterMuted } = await import('./audio-context')
    const gain = getMasterGain() as unknown as FakeGainNode
    setMasterMuted(true)
    expect(gain.gain.value).toBe(0)
    setMasterMuted(false)
    expect(gain.gain.value).toBe(1)
  })

  it('a master gain created after setMasterMuted(true) starts silenced', async () => {
    const { getMasterGain, setMasterMuted } = await import('./audio-context')
    setMasterMuted(true)
    const gain = getMasterGain() as unknown as FakeGainNode
    expect(gain.gain.value).toBe(0)
  })

  it('getMasterGain returns null when Web Audio is unavailable', async () => {
    vi.resetModules()
    vi.stubGlobal('AudioContext', undefined)
    vi.stubGlobal('webkitAudioContext', undefined)
    const { getMasterGain } = await import('./audio-context')
    expect(getMasterGain()).toBeNull()
  })
})
