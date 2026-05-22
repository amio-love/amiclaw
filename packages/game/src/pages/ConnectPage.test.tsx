/**
 * ConnectPage unit tests.
 *
 * Covers the connect-AI flow at /game/connect — the Atlas redesign's
 * 3-step handoff (design_handoff_bombsquad README §6.2):
 *   1. step 1 renders the copy-manual card with the manual URL.
 *   2. copying the manual shows the copied feedback and auto-advances to
 *      step 2 after ~0.7s.
 *   3. the 3-step state machine reaches the ready step and confirms.
 *   4. daily mode hands off to the run carrying the manual URL as ?url=.
 *   5. practice mode hands off without a ?url= param.
 *   6. step 1 surfaces the /compatibility discovery link (re-homed from
 *      the retired PromptModal).
 *
 * useDailyChallenge is mocked to deterministic URLs; copyToClipboard is
 * stubbed to its success branch so the copy → auto-advance path runs
 * without depending on the jsdom Clipboard API. The navigation target is
 * asserted with a sibling-route location probe.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

const DAILY_URL = 'https://bombsquad.amio.fans/manual/2026-05-22'
const PRACTICE_URL = 'https://bombsquad.amio.fans/manual/practice'

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

/* Renders the current location so the run-handoff target is assertable
   without mounting the real GamePage. */
function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname + location.search}</div>
}

function renderConnect(mode: 'daily' | 'practice') {
  return render(
    <MemoryRouter initialEntries={[`/game/connect?mode=${mode}`]}>
      <Routes>
        <Route path="/game/connect" element={<ConnectPage />} />
        <Route path="/game/run" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>
  )
}

/* Drive the flow from step 1 to step 2 by copying the manual and waiting
   for the ~0.7s auto-advance to settle. Waiting for step 2 to actually
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

  it('renders step 1 with the copy-manual card and the manual URL', () => {
    renderConnect('daily')

    expect(screen.getByText('第 1/3 步')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: /把手册发给 AI/ })).toBeInTheDocument()
    // The copy card carries the manual-link label and the daily manual URL.
    expect(screen.getByText('手册链接')).toBeInTheDocument()
    expect(screen.getByText(DAILY_URL)).toBeInTheDocument()
  })

  it('surfaces the /compatibility discovery link on step 1', () => {
    renderConnect('daily')

    // The link re-homes the entry point lost when PromptModal was removed;
    // it must point at the /compatibility route to keep that page reachable.
    const compatLink = screen.getByRole('link', { name: /查看支持工具/ })
    expect(compatLink).toBeInTheDocument()
    expect(compatLink).toHaveAttribute('href', '/compatibility')
  })

  it('shows the copied feedback and auto-advances to step 2 after ~0.7s', async () => {
    renderConnect('practice')

    fireEvent.click(screen.getByRole('button', { name: /手册链接/ }))

    // Copy action — the card flips to its copied state.
    await waitFor(() => {
      expect(screen.getByText('已复制到剪贴板')).toBeInTheDocument()
    })
    expect(copyToClipboard).toHaveBeenCalledTimes(1)
    expect(copyToClipboard).toHaveBeenCalledWith(PRACTICE_URL)

    // ~0.7s auto-advance — step 2 (voice mode) takes over in place.
    await waitFor(() => {
      expect(screen.getByText('切到语音模式')).toBeInTheDocument()
    })
  })

  it('walks the 3-step state machine to the ready step', async () => {
    renderConnect('practice')

    // Step 1 → step 2 via copy + auto-advance.
    await copyAndReachStep2()

    // Step 2 → step 3 via the 下一步 CTA.
    fireEvent.click(screen.getByRole('button', { name: /下一步/ }))

    // Step 3 — the ready step, with the confirm CTA.
    expect(screen.getByText('第 3/3 步')).toBeInTheDocument()
    expect(screen.getByText('AI 已读完手册，正在等你。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /确认开始游戏/ })).toBeInTheDocument()
  })

  it('hands daily mode off to the run carrying the manual URL as ?url=', async () => {
    renderConnect('daily')

    await copyAndReachStep2()
    fireEvent.click(screen.getByRole('button', { name: /下一步/ }))
    fireEvent.click(screen.getByRole('button', { name: /确认开始游戏/ }))

    const location = screen.getByTestId('location').textContent ?? ''
    expect(location).toContain('/game/run')
    expect(location).toContain('mode=daily')
    expect(location).toContain(`url=${encodeURIComponent(DAILY_URL)}`)
  })

  it('hands practice mode off to the run without a ?url= param', async () => {
    renderConnect('practice')

    await copyAndReachStep2()
    fireEvent.click(screen.getByRole('button', { name: /下一步/ }))
    fireEvent.click(screen.getByRole('button', { name: /确认开始游戏/ }))

    const location = screen.getByTestId('location').textContent ?? ''
    expect(location).toBe('/game/run?mode=practice')
    expect(location).not.toContain('url=')
  })
})
