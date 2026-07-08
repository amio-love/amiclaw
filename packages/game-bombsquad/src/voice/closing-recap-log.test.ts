import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { recordClosingRecapFired, wasClosingRecapFired } from './closing-recap-log'

/** Map-backed localStorage (the workspace jsdom env has no functional one). */
function installMemoryStorage(): void {
  const map = new Map<string, string>()
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, String(v)),
      removeItem: (k: string) => void map.delete(k),
      clear: () => map.clear(),
      key: (i: number) => [...map.keys()][i] ?? null,
      get length() {
        return map.size
      },
    },
  })
}

describe('closing-recap-log', () => {
  beforeEach(() => installMemoryStorage())
  afterEach(() => {
    // Restore the non-functional default so the store's fail-safe path is exercised elsewhere.
    Reflect.deleteProperty(window, 'localStorage')
  })

  it('records a run and reports it as fired', () => {
    recordClosingRecapFired('run-1')
    expect(wasClosingRecapFired('run-1')).toBe(true)
  })

  it('reports a DIFFERENT run as not fired (single-slot, per-run)', () => {
    recordClosingRecapFired('run-1')
    expect(wasClosingRecapFired('run-2')).toBe(false)
  })

  it('a later run overwrites the previous record (self-cleaning)', () => {
    recordClosingRecapFired('run-1')
    recordClosingRecapFired('run-2')
    expect(wasClosingRecapFired('run-1')).toBe(false)
    expect(wasClosingRecapFired('run-2')).toBe(true)
  })

  it('null / empty run ids are never "fired"', () => {
    expect(wasClosingRecapFired(null)).toBe(false)
    expect(wasClosingRecapFired('')).toBe(false)
    recordClosingRecapFired('') // no-op
    expect(wasClosingRecapFired('run-1')).toBe(false)
  })
})

describe('closing-recap-log — no storage available (fail-safe)', () => {
  it('reports not-fired rather than throwing when localStorage is unavailable', () => {
    // No installMemoryStorage() here → the default env has no functional storage.
    expect(() => recordClosingRecapFired('run-1')).not.toThrow()
    expect(wasClosingRecapFired('run-1')).toBe(false)
  })
})
