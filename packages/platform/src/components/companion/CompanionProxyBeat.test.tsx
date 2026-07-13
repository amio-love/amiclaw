/**
 * CompanionProxyBeat — the 甲-side事后透明 line (spec §Variant 3, mockup 屏 C).
 *
 * Covers: the once-per-session V1 trigger fires when signed-in WITH a companion;
 * a `messaged:true` response renders the transparency line built from the
 * returned target-event facts (all three template variants); the 「→ 看看我说了
 * 什么」 link routes to the community feed; ✕ dismisses; a silent `none` outcome
 * renders nothing; and no companion means no trigger.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import CompanionProxyBeat from './CompanionProxyBeat'
import { buildProxyBeatText, __resetProxyBeatSession } from './useCompanionProxyBeat'
import { triggerCompanionProxyMessage } from '@/lib/proxy-social-api'
import type { CompanionState } from '@/hooks/useCompanion'
import type { AuthState } from '@/hooks/useAuth'
import type { CompanionIdentity } from '@shared/companion-types'

vi.mock('@/lib/proxy-social-api', () => ({
  triggerCompanionProxyMessage: vi.fn(),
}))

const authState: { current: AuthState } = { current: { status: 'anon', user: null } }
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ ...authState.current, logout: async () => {} }),
}))

const companionState: { current: CompanionState } = {
  current: { status: 'loading', companion: null },
}
vi.mock('@/hooks/useCompanion', () => ({
  useCompanion: () => ({ state: companionState.current, reload: () => {} }),
}))

const mockedTrigger = vi.mocked(triggerCompanionProxyMessage)

const COMPANION: CompanionIdentity = {
  name: '阿澈',
  address_style: '',
  voice_id: 'companion-warm',
  profile_enabled: true,
  voice_posture: 'voice-default',
  created_at: new Date().toISOString(),
}

const AUTHED: AuthState = {
  status: 'authed',
  user: { user_id: 'u1', email: 'u@x.com', displayName: 'u', avatarLetter: 'U' },
}

function renderBeat() {
  return render(
    <MemoryRouter>
      <CompanionProxyBeat />
    </MemoryRouter>
  )
}

describe('CompanionProxyBeat', () => {
  beforeEach(() => {
    __resetProxyBeatSession()
    mockedTrigger.mockReset()
    authState.current = AUTHED
    companionState.current = {
      status: 'exists',
      companion: COMPANION,
      stats: { games_completed: 0, successes: 0 },
    }
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('fires the trigger and renders the transparency line anchored at the event', async () => {
    mockedTrigger.mockResolvedValue({
      kind: 'messaged',
      messageId: 'm1',
      targetEvent: {
        event_id: 'e0123456789abcde',
        template: 'leaderboard_entry',
        target_public_label: 'Player 53CD',
      },
    })
    renderBeat()

    expect(mockedTrigger).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/替你送了句祝贺/)).toBeInTheDocument()
    const cta = screen.getByRole('link', { name: /看看我说了什么/ })
    // The 查看 link anchors at the exact event, not the bare feed.
    expect(cta).toHaveAttribute('href', '/community?event=e0123456789abcde')
  })

  it('dismisses the line on ✕', async () => {
    mockedTrigger.mockResolvedValue({
      kind: 'messaged',
      messageId: 'm1',
      targetEvent: {
        event_id: 'e0123456789abcde',
        template: 'daily_clear',
        target_public_label: 'Player 53CD',
      },
    })
    renderBeat()

    fireEvent.click(await screen.findByRole('button', { name: '关闭' }))
    await waitFor(() => expect(screen.queryByText(/道了句漂亮/)).not.toBeInTheDocument())
  })

  it('renders nothing on a silent (none) outcome', async () => {
    mockedTrigger.mockResolvedValue({ kind: 'none' })
    renderBeat()

    await waitFor(() => expect(mockedTrigger).toHaveBeenCalled())
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('never triggers when the signed-in player has no companion', async () => {
    companionState.current = { status: 'none', companion: null }
    renderBeat()

    expect(mockedTrigger).not.toHaveBeenCalled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('builds each of the three template variants from real target facts', () => {
    const base = { event_id: 'e0123456789abcde', target_public_label: '乙' }
    expect(buildProxyBeatText({ ...base, template: 'daily_clear' })).toBe(
      '我看到 乙 拆掉了今天的每日挑战，替你道了句漂亮'
    )
    expect(buildProxyBeatText({ ...base, template: 'leaderboard_entry' })).toBe(
      '我看到 乙 登上了连续打卡榜，替你送了句祝贺'
    )
    expect(buildProxyBeatText({ ...base, template: 'streak_milestone', streak_days: 9 })).toBe(
      '我看到 乙 连续打卡到了第 9 天，替你道了句佩服'
    )
  })
})
