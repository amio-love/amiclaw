import { describe, it, expect } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useGardenSession } from './useGardenSession'
import { botanicalGameType, tutorialLevel } from '@/data/load'

function mount() {
  return renderHook(() => useGardenSession(botanicalGameType, tutorialLevel))
}

function plant(result: { current: ReturnType<typeof useGardenSession> }, id: string) {
  const p = result.current.plants.find((x) => x.id === id)
  if (!p) throw new Error(`plant ${id} not found`)
  return p
}

describe('useGardenSession — care actions', () => {
  it('heals a wilting plant on correct care (select → verb → state change)', () => {
    const { result } = mount()
    expect(plant(result, 'plant-1').health).toBe('wilting') // fern starts wilting

    act(() => {
      result.current.performCare('plant-1', 'water')
    })

    expect(plant(result, 'plant-1').health).toBe('stable')
    expect(result.current.ops).toBe(1)
  })

  it('shading the orchid adjusts light AND heals it in one care', () => {
    const { result } = mount()
    act(() => {
      result.current.performCare('plant-3', 'shade')
    })
    const orchid = plant(result, 'plant-3')
    expect(orchid.effectiveLight).toBe('partial_shade')
    expect(orchid.health).toBe('stable')
  })

  it('reaches the win state through the tutorial care path', () => {
    const { result } = mount()
    act(() => {
      result.current.performCare('plant-1', 'water') // fern wilting → stable
    })
    act(() => {
      result.current.performCare('plant-3', 'shade') // orchid → partial_shade + heal → stable
    })
    act(() => {
      result.current.performCare('plant-3', 'fertilize') // seedling → juvenile
    })
    act(() => {
      result.current.performCare('plant-3', 'repot') // juvenile → mature
    })
    act(() => {
      result.current.performCare('plant-3', 'bloom') // mature → flowering
    })

    expect(result.current.status).toBe('won')
    expect(plant(result, 'plant-3').growthStage).toBe('flowering')
  })
})

describe('useGardenSession — timed decay', () => {
  it('raises the decay warning as a plant nears its neglect tick', () => {
    const { result } = mount()
    // plant-3 has offset 40000 / interval 60000 → tick at 20000ms; warning
    // window is the last 8000ms, so 15000ms elapsed is inside it.
    act(() => {
      result.current.advance(15000)
    })
    const orchid = plant(result, 'plant-3')
    expect(orchid.decayWarning).toBe(true)
    expect(orchid.health).toBe('wilting') // not yet ticked
    expect(orchid.decayFraction).toBeGreaterThan(0.9)
  })

  it('lets an untended plant decay to death → lost (lose reachable)', () => {
    const { result } = mount()

    act(() => {
      result.current.advance(20000) // plant-3 neglect: wilting → critical
    })
    expect(plant(result, 'plant-3').health).toBe('critical')
    expect(result.current.status).toBe('playing')

    act(() => {
      result.current.advance(60000) // plant-3 neglect: critical → dead
    })
    expect(plant(result, 'plant-3').health).toBe('dead')
    expect(result.current.status).toBe('lost')
  })

  it('freezes time once the run has ended', () => {
    const { result } = mount()
    act(() => {
      result.current.advance(20000)
    })
    act(() => {
      result.current.advance(60000) // → lost
    })
    const elapsedAtLoss = result.current.elapsedMs
    act(() => {
      result.current.advance(60000) // no-op after end
    })
    expect(result.current.elapsedMs).toBe(elapsedAtLoss)
  })
})

describe('useGardenSession — reset', () => {
  it('restores the initial board, clock, and op count', () => {
    const { result } = mount()
    act(() => {
      result.current.performCare('plant-1', 'water')
    })
    act(() => {
      result.current.advance(5000)
    })
    expect(result.current.ops).toBe(1)
    expect(result.current.elapsedMs).toBe(5000)

    act(() => {
      result.current.reset()
    })

    expect(result.current.status).toBe('playing')
    expect(result.current.ops).toBe(0)
    expect(result.current.elapsedMs).toBe(0)
    expect(plant(result, 'plant-1').health).toBe('wilting')
  })
})
