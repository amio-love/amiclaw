import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionProvider } from '../session'
import { PageHome } from './PageHome'
import { PageProjection } from './PageProjection'
import { PageCasting } from './PageCasting'
import { PageReading } from './PageReading'
import { PageSign } from './PageSign'

// The cast-completed PageSign scan below submits the sign to the profile API;
// stub the network boundary so the scan stays offline (anon = local-only save).
vi.mock('@amiclaw/arcade-profile/api-client', () => ({
  submitArcadeProfileEvent: vi.fn(() => Promise.resolve({ kind: 'anon' })),
}))

/** In-memory Storage stand-in — this vitest jsdom setup exposes no global
 *  `localStorage` (Node's experimental one is disabled), and the arcade-profile
 *  local store checks `typeof localStorage` at the global scope. */
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

/* Honesty regression — the oracle flow makes zero model / voice API calls, so
   no screen may claim AI, voice, or mind-reading involvement. These strings
   were removed by the 诚实仪式 rework (audit F24/F25) and must never render
   again while the flow stays a pure frontend ritual. The demo-era interim
   markers (卦例演示 / 固定卦例 / 样例) joined the ban when real three-coin
   randomness + the full 64-hexagram manual landed: the cast is real now, so
   demo labeling would itself be a false claim. */

const BANNED_STRINGS = [
  'AI',
  'Claude',
  '语音',
  '读心',
  '正在说话',
  '听你说',
  '随时打断',
  // The cold-reading confirm row fabricated a dialogue; its buttons are the
  // regression canary for the fake-conversation mechanic as a whole.
  '不太对',
  '差不多',
  // The fixed demo cast era is over — neither the old「真实卦签」overclaim nor
  // the demo-era interim markers may render anywhere in the flow.
  '真实卦签',
  '卦例演示',
  '固定卦例',
  '样例',
] as const

const PAGES = [
  ['PageHome', PageHome],
  ['PageProjection', PageProjection],
  ['PageCasting', PageCasting],
  ['PageReading', PageReading],
  ['PageSign', PageSign],
] as const

// Matches SessionProvider's StoredSession shape — seeds a cast-completed
// session so PageReading / PageSign render their real content branch instead
// of redirecting home (they carry no demo fallback any more).
const CAST_COMPLETED_SESSION = {
  picked: ['a', 'b'],
  yaoValues: [7, 8, 9, 7, 7, 7],
  castCreatedAt: '2026-07-07T08:00:00.000Z',
  stage: 2,
  sessionId: 'honesty-scan-session',
}

function seedCastCompletedSession() {
  sessionStorage.setItem('amiclaw-yijing-session-v1', JSON.stringify(CAST_COMPLETED_SESSION))
}

function renderPage(Page: (typeof PAGES)[number][1]) {
  return render(
    <SessionProvider>
      <MemoryRouter>
        <Page />
      </MemoryRouter>
    </SessionProvider>
  )
}

function expectNoBannedStrings(container: HTMLElement) {
  const text = container.textContent ?? ''
  for (const banned of BANNED_STRINGS) {
    expect(text).not.toContain(banned)
  }
}

describe('oracle honesty — no AI / voice / mind-reading / demo-label claims', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.stubGlobal('localStorage', memoryStorage())
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it.each(PAGES)('%s renders none of the banned claim strings', (_name, Page) => {
    // Cast-completed session: PageReading / PageSign render their full content
    // branch (empty sessions would redirect and scan an empty container).
    seedCastCompletedSession()
    const { container } = renderPage(Page)
    expectNoBannedStrings(container)
  })

  it('PageSign with a completed cast scans clean on the save/check-in branch too', async () => {
    seedCastCompletedSession()
    const { container } = renderPage(PageSign)

    expect(await screen.findByText('已保存到本设备')).toBeTruthy()
    expect(screen.getByText('本次卦签已计入今日清单。')).toBeTruthy()
    expectNoBannedStrings(container)
  })

  it('PageHome presents the real coin cast without any demo caveat', () => {
    const { container } = renderPage(PageHome)
    expect(container.textContent).toContain('投一次硬币，读一卦')
    expect(container.textContent).toContain('三枚硬币起卦')
  })
})
