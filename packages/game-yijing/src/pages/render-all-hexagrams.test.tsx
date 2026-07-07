import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KW_LOOKUP } from '../glyphs/kw-lookup'
import type { YaoSextet, YaoValue } from '../glyphs/utils'
import { hexagramByNumber } from '../manual'
import { SessionProvider } from '../session'
import { PageReading } from './PageReading'
import { PageSign } from './PageSign'

/* Render safety over the full 64-hexagram domain.
 *
 * The cast is genuinely random now, so /reading and /sign must render EVERY
 * hexagram × changing-line combination without crashing and without the
 * "暂未收录" missing-entry fallback. Property-style sweep: all 64 numbers ×
 * three line patterns (no changing line / one changing line / all changing). */

// PageSign submits the sign to the profile API; stub the network boundary.
vi.mock('@amiclaw/arcade-profile/api-client', () => ({
  submitArcadeProfileEvent: vi.fn(() => Promise.resolve({ kind: 'anon' })),
}))

/** In-memory Storage stand-in — this vitest jsdom setup exposes no global
 *  `localStorage` (the arcade-profile local store probes it at global scope). */
function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  }
}

// number → bottom-up binary key, derived by reversing KW_LOOKUP.
const BINARY_BY_NUMBER = new Map<number, string>(
  Object.entries(KW_LOOKUP).map(([binary, [num]]) => [num, binary])
)

type Pattern = 'static' | 'one-changing' | 'all-changing'

function sextetFor(binary: string, pattern: Pattern): YaoSextet {
  const values = [...binary].map((bit, idx) => {
    const yang = bit === '1'
    if (pattern === 'all-changing' || (pattern === 'one-changing' && idx === 0)) {
      return (yang ? 9 : 6) as YaoValue
    }
    return (yang ? 7 : 8) as YaoValue
  })
  return values as unknown as YaoSextet
}

function seedSession(values: YaoSextet, sessionId: string) {
  sessionStorage.setItem(
    'amiclaw-yijing-session-v1',
    JSON.stringify({
      picked: ['a', 'b'],
      yaoValues: values,
      castCreatedAt: '2026-07-07T08:00:00.000Z',
      stage: 2,
      sessionId,
    })
  )
}

function renderWithSession(page: React.ReactElement) {
  return render(
    <SessionProvider>
      <MemoryRouter>{page}</MemoryRouter>
    </SessionProvider>
  )
}

const ALL_NUMBERS = Array.from({ length: 64 }, (_, i) => i + 1)

describe('all-64 render safety', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.stubGlobal('localStorage', memoryStorage())
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it.each(ALL_NUMBERS)(
    'PageReading renders hexagram #%i under every changing-line pattern',
    (n) => {
      const binary = BINARY_BY_NUMBER.get(n)
      const entry = hexagramByNumber(n)
      expect(binary && entry).toBeTruthy()
      if (!binary || !entry) return

      for (const pattern of ['static', 'one-changing', 'all-changing'] as Pattern[]) {
        seedSession(sextetFor(binary, pattern), `reading-${n}-${pattern}`)
        renderWithSession(<PageReading />)

        expect(screen.getAllByText(entry.judgment.classical).length).toBeGreaterThan(0)
        expect(screen.getAllByText(entry.image.classical).length).toBeGreaterThan(0)
        expect(screen.queryByText(/暂未收录/)).toBeNull()
        cleanup()
        sessionStorage.clear()
      }
    }
  )

  it.each(ALL_NUMBERS)('PageSign renders hexagram #%i with a changing line', (n) => {
    const binary = BINARY_BY_NUMBER.get(n)
    const entry = hexagramByNumber(n)
    expect(binary && entry).toBeTruthy()
    if (!binary || !entry) return

    seedSession(sextetFor(binary, 'one-changing'), `sign-${n}`)
    renderWithSession(<PageSign />)

    expect(screen.getAllByText(entry.judgment.classical).length).toBeGreaterThan(0)
    // The takeaway is the first changing line's modern gloss (line 1 changes).
    expect(screen.getAllByText(entry.lines[0].modern_interpretation).length).toBeGreaterThan(0)
  })

  /* 用九/用六 — the all-six-changing 乾/坤 casts read the special line in
   * place of the six individual 爻辞. Reachable under real randomness
   * ((1/8)^6 per pattern), so the path must render, never crash. */
  const EXTRA_LINE_CASES = [
    { n: 1, name: '乾', label: '用九', classical: '见群龙无首，吉。', firstLine: '潜龙勿用。' },
    { n: 2, name: '坤', label: '用六', classical: '利永贞。', firstLine: '履霜，坚冰至。' },
  ] as const

  it.each(EXTRA_LINE_CASES)(
    'PageReading reads $label in place of the six 爻辞 on an all-six-changing $name cast',
    ({ n, label, classical, firstLine }) => {
      const binary = BINARY_BY_NUMBER.get(n)
      const entry = hexagramByNumber(n)
      expect(binary && entry?.extra_line).toBeTruthy()
      if (!binary || !entry?.extra_line) return

      seedSession(sextetFor(binary, 'all-changing'), `extra-${n}`)
      renderWithSession(<PageReading />)

      expect(screen.getByText(`变爻 · ${label}`)).toBeTruthy()
      expect(screen.getByText(classical)).toBeTruthy()
      expect(screen.getByText(entry.extra_line.modern_interpretation)).toBeTruthy()
      // The special line REPLACES the six individual 爻辞.
      expect(screen.queryByText(firstLine)).toBeNull()
      expect(screen.queryByText(/暂未收录/)).toBeNull()
    }
  )

  it.each(EXTRA_LINE_CASES)(
    'PageSign uses the $label gloss as the takeaway on an all-six-changing $name cast',
    ({ n }) => {
      const binary = BINARY_BY_NUMBER.get(n)
      const entry = hexagramByNumber(n)
      expect(binary && entry?.extra_line).toBeTruthy()
      if (!binary || !entry?.extra_line) return

      seedSession(sextetFor(binary, 'all-changing'), `extra-sign-${n}`)
      renderWithSession(<PageSign />)

      expect(screen.getAllByText(entry.extra_line.modern_interpretation).length).toBeGreaterThan(0)
    }
  )
})
