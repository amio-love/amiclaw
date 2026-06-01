/**
 * ConnectPage unit tests.
 *
 * Covers the connect-AI flow at /bombsquad/connect — the Atlas redesign's
 * 2-step handoff (design_handoff_bombsquad README §6.2):
 *   1. step 1 renders the copy card (opening prompt + manual URL) with the
 *      manual URL and surfaces the opening-prompt text inline.
 *   2. copying the handoff message shows the copied feedback and auto-advances
 *      to step 2 after ~0.7s; the clipboard payload pairs OPENING_PROMPT with
 *      the manual URL.
 *   3. the 2-step state machine reaches the voice-mode step and hands off.
 *   4. daily mode hands off to the run carrying the manual URL as ?url=.
 *   5. practice mode hands off without a ?url= param.
 *   6. step 1 surfaces the /bombsquad/compatibility discovery link
 *      (re-homed from the retired PromptModal).
 *
 * The readiness gate now lives once on GamePage's "开始" button, so this flow
 * ends with a plain "进入游戏" navigation — there is no second confirm here.
 *
 * useDailyChallenge is mocked to deterministic URLs; copyToClipboard is
 * stubbed to its success branch so the copy → auto-advance path runs
 * without depending on the jsdom Clipboard API. The navigation target is
 * asserted with a sibling-route location probe.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

const DAILY_URL = 'https://claw.amio.fans/manual/2026-05-22'
const PRACTICE_URL = 'https://claw.amio.fans/manual/practice'

vi.mock('@/hooks/useDailyChallenge', () => ({
  useDailyChallenge: () => ({
    dailyUrl: DAILY_URL,
    practiceUrl: PRACTICE_URL,
    attemptNumber: 1,
    incrementAttempt: () => {},
  }),
}))

vi.mock('@/utils/clipboard', () => ({
  copyToClipboard: vi.fn().mockResolvedValue(true),
}))

import ConnectPage from './ConnectPage'
import { copyToClipboard } from '@/utils/clipboard'
import { OPENING_PROMPT } from '@/constants/opening-prompt'

/* Renders the current location so the run-handoff target is assertable
   without mounting the real GamePage. */
function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname + location.search}</div>
}

function renderConnect(mode: 'daily' | 'practice') {
  return render(
    <MemoryRouter initialEntries={[`/bombsquad/connect?mode=${mode}`]}>
      <Routes>
        <Route path="/bombsquad/connect" element={<ConnectPage />} />
        <Route path="/bombsquad/run" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>
  )
}

/* Drive the flow from step 1 to step 2 by copying the handoff message and
   waiting for the ~0.7s auto-advance to settle. Waiting for step 2 to actually
   render means the auto-advance timer has already fired, so it can never
   race a later manual step change. */
async function copyAndReachStep2() {
  fireEvent.click(screen.getByRole('button', { name: /手册链接/ }))
  await waitFor(() => {
    expect(screen.getByText('切到语音模式')).toBeInTheDocument()
  })
}

describe('ConnectPage', () => {
  beforeEach(() => {
    vi.mocked(copyToClipboard).mockClear()
    vi.mocked(copyToClipboard).mockResolvedValue(true)
  })

  it('renders step 1 with the copy card, manual URL, and opening prompt', () => {
    renderConnect('daily')

    expect(screen.getByText('第 1/2 步')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: /发给 AI/ })).toBeInTheDocument()
    // The copy card pairs the opening prompt with the manual link.
    expect(screen.getByText('开场白 + 手册链接')).toBeInTheDocument()
    expect(screen.getByText(DAILY_URL)).toBeInTheDocument()
    // The opening prompt is surfaced inline (not buried behind /compatibility).
    // Matched by signature lines — getByText normalizes the <pre> whitespace,
    // so an exact multi-line match is unreliable.
    expect(screen.getByText(/等会儿我会发你一个 URL/)).toBeInTheDocument()
    expect(screen.getByText(/每次只回复一步指令/)).toBeInTheDocument()
  })

  it('surfaces the /bombsquad/compatibility discovery link on step 1', () => {
    renderConnect('daily')

    // The link re-homes the entry point lost when PromptModal was removed;
    // it must point at the /bombsquad/compatibility route to keep that page
    // reachable.
    const compatLink = screen.getByRole('link', { name: /查看支持工具/ })
    expect(compatLink).toBeInTheDocument()
    expect(compatLink).toHaveAttribute('href', '/bombsquad/compatibility')
  })

  it('copies prompt + manual together and auto-advances to step 2 after ~0.7s', async () => {
    renderConnect('practice')

    fireEvent.click(screen.getByRole('button', { name: /手册链接/ }))

    // Copy action — the card flips to its copied state.
    await waitFor(() => {
      expect(screen.getByText('已复制到剪贴板')).toBeInTheDocument()
    })
    expect(copyToClipboard).toHaveBeenCalledTimes(1)
    // The clipboard payload is the opening prompt followed by the manual URL.
    expect(copyToClipboard).toHaveBeenCalledWith(`${OPENING_PROMPT}\n\n${PRACTICE_URL}`)

    // ~0.7s auto-advance — step 2 (voice mode) takes over in place.
    await waitFor(() => {
      expect(screen.getByText('切到语音模式')).toBeInTheDocument()
    })
  })

  it('walks the 2-step state machine to the voice-mode step', async () => {
    renderConnect('practice')

    // Step 1 → step 2 via copy + auto-advance.
    await copyAndReachStep2()

    // Step 2 — the voice-mode step, with the run handoff CTA. No second
    // readiness confirm — that gate lives on GamePage's "开始" button.
    expect(screen.getByText('第 2/2 步')).toBeInTheDocument()
    expect(screen.getByText('切到语音模式')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /进入游戏/ })).toBeInTheDocument()
  })

  it('hands daily mode off to the run carrying the manual URL as ?url=', async () => {
    renderConnect('daily')

    await copyAndReachStep2()
    fireEvent.click(screen.getByRole('button', { name: /进入游戏/ }))

    const location = screen.getByTestId('location').textContent ?? ''
    expect(location).toContain('/bombsquad/run')
    expect(location).toContain('mode=daily')
    expect(location).toContain(`url=${encodeURIComponent(DAILY_URL)}`)
  })

  it('hands practice mode off to the run without a ?url= param', async () => {
    renderConnect('practice')

    await copyAndReachStep2()
    fireEvent.click(screen.getByRole('button', { name: /进入游戏/ }))

    const location = screen.getByTestId('location').textContent ?? ''
    expect(location).toBe('/bombsquad/run?mode=practice')
    expect(location).not.toContain('url=')
  })
})
