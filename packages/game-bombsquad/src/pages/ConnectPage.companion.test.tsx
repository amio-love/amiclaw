/**
 * ConnectPage companion co-play entry tests (the arcade closure plan's entry
 * fix + companion-presence-design).
 *
 * A signed-in player WITH a companion entering the DAILY challenge defaults to
 * the platform voice partner (mode②): one tap into the run with
 * `?partner=platform`, no manual handoff. There is no co-equal platform-AI vs
 * BYO chooser (owner ruling) — the BYO manual flow is demoted to a low-key
 * secondary link, still one tap away. Practice entries never consult the gate.
 *
 * `useCompanionPartner` is mocked per test — the gate's own fetch behaviour is
 * covered by useCompanionPartner.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import type { CompanionPartnerState } from '@/hooks/useCompanionPartner'

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

vi.mock('@/audio/audio-context', () => ({
  getAudioContext: vi.fn().mockReturnValue(null),
}))

const partnerState = vi.hoisted(() => ({
  current: { status: 'unavailable' } as CompanionPartnerState,
}))

vi.mock('@/hooks/useCompanionPartner', () => ({
  useCompanionPartner: (enabled: boolean) =>
    enabled ? partnerState.current : { status: 'unavailable' },
}))

import ConnectPage from './ConnectPage'
import { getAudioContext } from '@/audio/audio-context'
import { GameProvider } from '@/store/game-context'
import { readEntryRecoveryState } from '@/utils/session'

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname + location.search}</div>
}

function renderConnect(mode: 'daily' | 'practice') {
  return render(
    <MemoryRouter initialEntries={[`/bombsquad/connect?mode=${mode}`]}>
      <Routes>
        <Route
          path="/bombsquad/connect"
          element={
            <GameProvider>
              <ConnectPage />
            </GameProvider>
          }
        />
        <Route path="/bombsquad/run" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('ConnectPage — companion co-play entry', () => {
  beforeEach(() => {
    sessionStorage.clear()
    partnerState.current = { status: 'available', name: '阿澈' }
    vi.mocked(getAudioContext).mockReset()
    vi.mocked(getAudioContext).mockReturnValue(null)
  })

  it('defaults a companion user into co-play with BYO demoted to a low-key link', () => {
    renderConnect('daily')

    // Co-play is the single default — no manual-copy step 1, no chooser.
    expect(screen.getByRole('heading', { level: 2, name: /阿澈/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /和 阿澈 一起进入/ })).toBeInTheDocument()
    expect(screen.queryByText('第 1/2 步')).not.toBeInTheDocument()
    // BYO stays reachable but is demoted to a low-key secondary link (not a
    // co-equal full-width button): asserted via its link styling class.
    const byo = screen.getByRole('button', { name: /自带 AI/ })
    expect(byo).toBeInTheDocument()
    expect(byo.className).toContain('byoLink')
  })

  it('hands off to the mode② run with partner=platform and unlocks audio in the tap', () => {
    renderConnect('daily')

    fireEvent.click(screen.getByRole('button', { name: /和 阿澈 一起进入/ }))

    const location = screen.getByTestId('location').textContent ?? ''
    expect(location).toContain('/bombsquad/run')
    expect(location).toContain('mode=daily')
    expect(location).toContain(`url=${encodeURIComponent(DAILY_URL)}`)
    expect(location).toContain('partner=platform')
    expect(getAudioContext).toHaveBeenCalledTimes(1)

    // Recovery state records the mode② entry so replay/recovery preserves it.
    expect(readEntryRecoveryState()).toEqual({
      mode: 'daily',
      manualUrl: DAILY_URL,
      manualHandoffComplete: true,
      platformPartner: true,
    })
  })

  it('steps off to the BYO manual flow on the alternative CTA', () => {
    renderConnect('daily')

    fireEvent.click(screen.getByRole('button', { name: /自带 AI/ }))

    // The original two-step handoff takes over.
    expect(screen.getByText('第 1/2 步')).toBeInTheDocument()
    expect(screen.getByText(DAILY_URL)).toBeInTheDocument()
  })

  it('holds the entry choice on neutral chrome while the gate resolves', () => {
    partnerState.current = { status: 'checking' }
    renderConnect('daily')

    expect(screen.getByText('正在准备…')).toBeInTheDocument()
    expect(screen.queryByText('第 1/2 步')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /一起进入/ })).not.toBeInTheDocument()
  })

  it('keeps the BYO flow for a player without a companion', () => {
    partnerState.current = { status: 'unavailable' }
    renderConnect('daily')

    expect(screen.getByText('第 1/2 步')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /一起进入/ })).not.toBeInTheDocument()
  })

  it('never consults the gate for practice entries', () => {
    // Even with a companion available, practice keeps the BYO flow — the
    // platform partner is a daily-only surface.
    renderConnect('practice')

    expect(screen.getByText('第 1/2 步')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /一起进入/ })).not.toBeInTheDocument()
  })
})
