import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ManualNetworkError,
  ManualNotFoundError,
  ManualParseError,
  loadManual,
} from './yaml-loader'

const SAMPLE_MANUAL_YAML = `
meta:
  version: "test"
  type: practice

modules:
  wire_routing: { rules: [] }
  symbol_dial: { columns: [] }
  button: { rules: [] }
  keypad: { sequences: [] }
`

// `*missing` references an undefined YAML anchor — js-yaml reliably throws
// a YAMLException ("undefined alias"), which is the parse-failure path we
// want to distinguish from network failures at the loader boundary.
const INVALID_YAML = '*missing'

describe('loadManual', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('rejects with ManualNotFoundError on 404', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('Manual not found', { status: 404 }))

    await expect(loadManual('https://example.test/manual/2099-01-01')).rejects.toBeInstanceOf(
      ManualNotFoundError
    )
  })

  it('rejects with ManualNetworkError on other non-ok responses', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('server boom', { status: 500 }))

    let caught: unknown
    try {
      await loadManual('https://example.test/manual/500-case')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ManualNetworkError)
    expect(caught).not.toBeInstanceOf(ManualNotFoundError)
    expect((caught as ManualNetworkError).status).toBe(500)
    expect((caught as Error).message).toContain('500')
  })

  it('rejects with ManualNetworkError when fetch itself rejects', async () => {
    const networkFailure = new TypeError('Failed to fetch')
    globalThis.fetch = vi.fn().mockRejectedValue(networkFailure)

    let caught: unknown
    try {
      await loadManual('https://example.test/manual/offline-case')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ManualNetworkError)
    expect((caught as ManualNetworkError).status).toBeUndefined()
    expect((caught as { cause?: unknown }).cause).toBe(networkFailure)
  })

  it('rejects with ManualParseError when the body is invalid YAML', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(INVALID_YAML, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      })
    )

    let caught: unknown
    try {
      await loadManual('https://example.test/manual/bad-yaml-case')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ManualParseError)
    expect(caught).not.toBeInstanceOf(ManualNetworkError)
  })

  it('returns the parsed manual on success', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(SAMPLE_MANUAL_YAML, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      })
    )

    const manual = await loadManual('https://example.test/manual/ok-case')
    expect(manual.meta?.version).toBe('test')
  })
})
