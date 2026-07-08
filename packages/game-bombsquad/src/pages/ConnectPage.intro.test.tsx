/**
 * ConnectPage first-run primer tests (F1).
 *
 * A brand-new anonymous player reaching the BYO connect flow gets one honest
 *「怎么玩」screen ONCE per device: it explains the unconventional premise
 * (you + a voice AI partner splitting the bomb vs the manual), points players
 * WITH a voice AI at the manual handoff, and players WITHOUT one at the platform
 * companion behind login. It is skippable (one tap into the same BYO steps) and
 * never blocks the flow. `hasSeenConnectIntro` is mocked per test to drive the
 * first-run vs returning-device branches; the util's own storage gating lives in
 * connect-intro.test.ts.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

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

// The co-play gate is mutable per test: default 'unavailable' (anonymous /
// companion-less — the BYO flow the primer fronts); a signed-in companion owner
// sets it 'available' to prove the primer is excluded from the co-play path.
const partnerState = vi.hoisted(() => ({
  current: { status: 'unavailable' } as { status: string; name?: string },
}))
vi.mock('@/hooks/useCompanionPartner', () => ({
  useCompanionPartner: (enabled: boolean) =>
    enabled ? partnerState.current : { status: 'unavailable' },
}))

vi.mock('@/audio/audio-context', () => ({
  getAudioContext: vi.fn().mockReturnValue(null),
}))

const introMock = vi.hoisted(() => ({ seen: false, mark: vi.fn() }))
vi.mock('@/utils/connect-intro', () => ({
  hasSeenConnectIntro: () => introMock.seen,
  markConnectIntroSeen: introMock.mark,
}))

import ConnectPage from './ConnectPage'
import { GameProvider } from '@/store/game-context'

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
      </Routes>
    </MemoryRouter>
  )
}

describe('ConnectPage first-run primer (F1)', () => {
  // jsdom's window.location.assign is non-configurable (spyOn throws), so replace
  // the whole location object with a minimal stub. MemoryRouter uses an in-memory
  // history and never reads window.location, so this is safe for the render.
  const realLocation = window.location
  let assignMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    introMock.seen = false
    introMock.mark.mockReset()
    partnerState.current = { status: 'unavailable' }
    assignMock = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { assign: assignMock },
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
  })

  it('shows the「怎么玩」primer on first anonymous daily entry, before the BYO steps', () => {
    renderConnect('daily')
    expect(screen.getByText('开始之前')).toBeInTheDocument()
    expect(screen.getByText(/先弄清/)).toBeInTheDocument()
    // The three honest points: premise, BYO-AI path, no-AI path.
    expect(screen.getByText(/你看得到炸弹面板但查不了资料/)).toBeInTheDocument()
    expect(screen.getByText(/把手册链接发给它/)).toBeInTheDocument()
    expect(screen.getByText(/登录后可以让平台的语音伙伴/)).toBeInTheDocument()
    // The BYO copy CTA is not reachable until the primer is dismissed.
    expect(screen.queryByRole('button', { name: '复制手册' })).not.toBeInTheDocument()
  })

  it('dismissing the primer marks it seen and reveals the BYO step 1', () => {
    renderConnect('daily')
    fireEvent.click(screen.getByRole('button', { name: '知道了，开始对接 →' }))
    expect(introMock.mark).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '复制手册' })).toBeInTheDocument()
    expect(screen.queryByText('开始之前')).not.toBeInTheDocument()
  })

  it('the no-AI CTA marks the primer seen and navigates to login', () => {
    renderConnect('daily')
    fireEvent.click(screen.getByRole('button', { name: '没有 AI？登录用平台伙伴 →' }))
    expect(introMock.mark).toHaveBeenCalledTimes(1)
    expect(assignMock).toHaveBeenCalledWith('/login')
  })

  it('does NOT show the primer once the device has seen it (returning player)', () => {
    introMock.seen = true
    renderConnect('daily')
    expect(screen.queryByText('开始之前')).not.toBeInTheDocument()
    // The BYO step 1 renders directly — byte-identical to the returning flow.
    expect(screen.getByRole('button', { name: '复制手册' })).toBeInTheDocument()
  })

  it('also fronts practice mode on first run', () => {
    renderConnect('practice')
    expect(screen.getByText('开始之前')).toBeInTheDocument()
  })

  it('never shows the primer to a signed-in companion owner entering co-play, even unseen', () => {
    // Companion available + intro unseen: the co-play default owns the screen,
    // and the「怎么玩」primer (whose no-AI path is irrelevant to them) is excluded.
    partnerState.current = { status: 'available', name: '阿澈' }
    renderConnect('daily')
    expect(screen.queryByText('开始之前')).not.toBeInTheDocument()
    // The co-play primary CTA renders instead.
    expect(screen.getByRole('button', { name: '和 阿澈 一起进入 →' })).toBeInTheDocument()
  })
})
