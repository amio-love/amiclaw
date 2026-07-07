/**
 * CompanionDock — the persistent presence bar.
 *
 * Covers the dock's identity gating (anonymous → nothing; signed-in without a
 * companion → the create entry; companion → the live dock), the stub-era
 * honesty pin (LOBBY_VOICE_CAPABLE=false → the lobby NEVER touches mic /
 * permission APIs; the mic button surfaces the honest in-game-voice note),
 * the quiet-remembered muted landing, and the mute control's posture write.
 * The full ratified auto-voice sequence is pinned flag-on in
 * CompanionDock.lobby-voice.test.tsx.
 *
 * useAuth / useCompanion / the companion API client are module-mocked; the
 * localStorage-backed posture cache and beat log run for real against jsdom's
 * localStorage (cleared per test).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { CompanionIdentity, VoicePosture } from '@shared/companion-types'
import { COMPANION_BEAT_LOG_KEY, VOICE_POSTURE_STORAGE_KEY } from '@shared/companion-presence'

const authState = vi.hoisted(() => ({
  current: { status: 'anon', user: null } as { status: string; user: unknown },
}))
const companionState = vi.hoisted(() => ({
  current: { status: 'loading', companion: null } as {
    status: string
    companion: CompanionIdentity | null
    stats?: unknown
  },
}))
const apiMocks = vi.hoisted(() => ({
  fetchMemories: vi.fn(),
  putVoicePosture: vi.fn(),
}))

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ ...authState.current, logout: async () => {} }),
}))
vi.mock('@/hooks/useCompanion', () => ({
  useCompanion: () => ({ state: companionState.current, reload: () => {} }),
}))
vi.mock('@/lib/companion-api', () => ({
  fetchMemories: apiMocks.fetchMemories,
  putVoicePosture: apiMocks.putVoicePosture,
}))

import CompanionDock from './CompanionDock'

const COMPANION: CompanionIdentity = {
  name: '阿澈',
  address_style: '',
  voice_id: 'companion-warm',
  profile_enabled: true,
  voice_posture: 'voice-default',
  created_at: '2026-06-30T00:00:00.000Z',
}

function signInWithCompanion(posture: VoicePosture = 'voice-default') {
  authState.current = { status: 'authed', user: { user_id: 'u1', email: 'a@b.c' } }
  companionState.current = {
    status: 'exists',
    companion: { ...COMPANION, voice_posture: posture },
    // Part of the exists shape; the dock never reads it.
    stats: { games_completed: 0, successes: 0 },
  }
}

/**
 * The workspace jsdom exposes no functional localStorage (Node >= 22 ships an
 * experimental undefined-without-flag global that wins), so install a real
 * in-memory Storage per test — the posture cache and beat log then run their
 * REAL read/write paths and stay assertable.
 */
function installMemoryStorage(): void {
  const map = new Map<string, string>()
  const storage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, String(value)),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size
    },
  }
  Object.defineProperty(window, 'localStorage', { configurable: true, value: storage })
}

function stubMic(outcome: 'granted' | 'denied') {
  const getUserMedia =
    outcome === 'granted'
      ? vi.fn().mockResolvedValue({ getTracks: () => [{ stop: () => {} }] })
      : vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError'))
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  })
  return getUserMedia
}

function renderDock(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <CompanionDock />
    </MemoryRouter>
  )
}

describe('CompanionDock', () => {
  beforeEach(() => {
    vi.useRealTimers()
    installMemoryStorage()
    authState.current = { status: 'anon', user: null }
    companionState.current = { status: 'loading', companion: null }
    apiMocks.fetchMemories.mockReset()
    apiMocks.fetchMemories.mockResolvedValue({ kind: 'ok', memories: [] })
    apiMocks.putVoicePosture.mockReset()
    apiMocks.putVoicePosture.mockResolvedValue({ kind: 'ok' })
  })

  it('renders nothing for an anonymous visitor', () => {
    renderDock()
    expect(screen.queryByRole('complementary', { name: '伙伴坞' })).not.toBeInTheDocument()
  })

  it('shows the create-companion entry for a signed-in player without one', () => {
    authState.current = { status: 'authed', user: { user_id: 'u1', email: 'a@b.c' } }
    companionState.current = { status: 'none', companion: null }
    renderDock()

    const entry = screen.getByRole('link', { name: '创建你的伙伴 →' })
    expect(entry).toHaveAttribute('href', '/me/companion')
  })

  it('lands the arrival greeting and NEVER touches the mic APIs while lobby voice is off', async () => {
    signInWithCompanion()
    const getUserMedia = stubMic('granted')
    apiMocks.fetchMemories.mockResolvedValue({
      kind: 'ok',
      memories: [
        {
          id: 'ep-1',
          occurred_at: '2026-07-07T20:00:00.000Z',
          game_id: 'bombsquad',
          title: '最后三秒拆掉了炸弹',
          narrative: 'n',
        },
      ],
    })
    renderDock()

    // Greeting text (from the real recent episode) lands — in the bubble AND
    // the dock text line.
    const greetings = await screen.findAllByText(/上次最后三秒拆掉了炸弹，我还记着/)
    expect(greetings.length).toBeGreaterThan(0)
    // The beat log recorded the greeting (daily cap + re-open suppression).
    expect(window.localStorage.getItem(COMPANION_BEAT_LOG_KEY)).toContain('"count":1')

    // THE stub-era honesty pin: with LOBBY_VOICE_CAPABLE=false the lobby must
    // never request the mic — wait well past the 300ms auto-voice delay and
    // assert no permission API was touched and no posture was written, so a
    // stub-era denial can never poison denied-remembered.
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(apiMocks.putVoicePosture).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(VOICE_POSTURE_STORAGE_KEY)).toBe('voice-default')
  })

  it('mic button surfaces the honest in-game-voice note instead of faking lobby voice', async () => {
    signInWithCompanion()
    const getUserMedia = stubMic('granted')
    renderDock('/leaderboard') // no greeting in the way

    fireEvent.click(screen.getByRole('button', { name: '语音陪伴说明' }))

    // The note leads somewhere TRUE (voice runs in the daily run) — and the
    // tap costs nothing: no permission call, no posture write.
    await screen.findByText('语音陪伴在拆弹局内可用，进入每日挑战开启。')
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(apiMocks.putVoicePosture).not.toHaveBeenCalled()
  })

  it('lands muted with no greeting and no permission request for a quiet-remembered visit', () => {
    signInWithCompanion('quiet-remembered')
    const getUserMedia = stubMic('granted')
    renderDock()

    expect(screen.getByText('阿澈在这（静音中）')).toBeInTheDocument()
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(apiMocks.fetchMemories).not.toHaveBeenCalled()
    // The mic button is present — while lobby voice is off it carries the
    // honest note affordance rather than a fake 开启语音.
    expect(screen.getByRole('button', { name: '语音陪伴说明' })).toBeInTheDocument()
  })

  it('never auto-requests permission on a denied-remembered visit', async () => {
    signInWithCompanion('denied-remembered')
    const getUserMedia = stubMic('granted')
    renderDock()

    expect(screen.getByText('阿澈在这（静音中）')).toBeInTheDocument()
    expect(getUserMedia).not.toHaveBeenCalled()

    // While lobby voice is off the mic tap surfaces the honest note only —
    // the real permission-retry path is pinned (flag-on) in
    // CompanionDock.lobby-voice.test.tsx.
    fireEvent.click(screen.getByRole('button', { name: '语音陪伴说明' }))
    await screen.findByText('语音陪伴在拆弹局内可用，进入每日挑战开启。')
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(apiMocks.putVoicePosture).not.toHaveBeenCalled()
  })

  it('mutes from the control menu and persists quiet-remembered', async () => {
    signInWithCompanion()
    stubMic('granted')
    renderDock('/leaderboard') // not the homepage — no greeting in the way

    // Open the control menu from the name region and mute.
    fireEvent.click(screen.getByRole('button', { name: '阿澈 控制菜单' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '静音' }))

    expect(screen.getByText('阿澈在这（静音中）')).toBeInTheDocument()
    await waitFor(() => expect(apiMocks.putVoicePosture).toHaveBeenCalledWith('quiet-remembered'))
    expect(window.localStorage.getItem(VOICE_POSTURE_STORAGE_KEY)).toBe('quiet-remembered')

    // 恢复自动语音 restores the default posture.
    fireEvent.click(screen.getByRole('button', { name: '阿澈 控制菜单' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '恢复自动语音' }))
    await waitFor(() => expect(apiMocks.putVoicePosture).toHaveBeenCalledWith('voice-default'))
    expect(screen.getByText('阿澈在这')).toBeInTheDocument()
  })

  it('fires no greeting away from the homepage', () => {
    signInWithCompanion()
    stubMic('granted')
    renderDock('/community')

    expect(apiMocks.fetchMemories).not.toHaveBeenCalled()
    expect(screen.getByText('阿澈在这')).toBeInTheDocument()
  })
})
