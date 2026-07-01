import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ManualNetworkError,
  ManualNotFoundError,
  ManualParseError,
  loadManual,
  toManualDataUrl,
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

// ---------------------------------------------------------------------------
// toManualDataUrl — regression: daily engine must fetch YAML, not HTML page
// ---------------------------------------------------------------------------
// Pre-fix: GamePage passed the HTML share URL (/manual/<date>) directly to
// loadManual, which returned HTML text that yaml.load() could not parse →
// ManualParseError → "手册格式异常". The fix routes the engine through
// toManualDataUrl so it always fetches /manual/data/<date>.yaml.

describe('toManualDataUrl', () => {
  it('converts the HTML share URL to the YAML data URL (root regression)', () => {
    // This is the exact transform the daily engine now applies on every start.
    // Red before fix: GamePage called loadManual('/manual/2026-06-30') directly.
    // Green after fix: GamePage calls loadManual(toManualDataUrl('/manual/2026-06-30')).
    expect(toManualDataUrl('https://claw.amio.fans/manual/2026-06-30')).toBe(
      'https://claw.amio.fans/manual/data/2026-06-30.yaml'
    )
  })

  it('preserves an arbitrary origin (preview / staging deployments)', () => {
    expect(toManualDataUrl('https://amiclaw.pages.dev/manual/2026-01-15')).toBe(
      'https://amiclaw.pages.dev/manual/data/2026-01-15.yaml'
    )
  })

  it('returns a data URL unchanged (idempotent — already correct path)', () => {
    const already = 'https://claw.amio.fans/manual/data/2026-06-30.yaml'
    expect(toManualDataUrl(already)).toBe(already)
  })

  it('does not transform the player→AI share URL shape (HTML page stays at /manual/<date>)', () => {
    // ConnectPage copies /manual/<date> to the clipboard — that URL must NOT
    // become the data URL. ConnectPage never calls toManualDataUrl; this test
    // confirms the two URL shapes are distinct after the conversion.
    const shareUrl = 'https://claw.amio.fans/manual/2026-06-30'
    const dataUrl = toManualDataUrl(shareUrl)
    expect(dataUrl).not.toBe(shareUrl)
    expect(dataUrl).toContain('/manual/data/')
    expect(dataUrl.endsWith('.yaml')).toBe(true)
  })
})

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
