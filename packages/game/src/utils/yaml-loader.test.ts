import { afterEach, describe, expect, it, vi } from 'vitest'
import { ManualNotFoundError, loadManual } from './yaml-loader'

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

  it('rejects with a generic Error on other non-ok responses', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('server boom', { status: 500 }))

    let caught: unknown
    try {
      await loadManual('https://example.test/manual/500-case')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(Error)
    expect(caught).not.toBeInstanceOf(ManualNotFoundError)
    expect((caught as Error).message).toContain('500')
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
