/**
 * CompanionPresence — the per-context presence component (shell / in-game).
 *
 * Flag-OFF honesty suite (`LOBBY_VOICE_CAPABLE=false`): the lobby NEVER touches
 * mic / permission APIs and the talk affordance surfaces the honest
 * in-game-voice note. Also covers the shell arrival greeting + milestone beat
 * (home context, pathname `/`), the restrained in-game strip's states, and the
 * shell memory-hook slot. The flag-ON auto-voice sequence is pinned separately
 * in CompanionPresence.lobby-voice.test.tsx.
 *
 * The companion API client is module-mocked; the localStorage-backed posture
 * cache and beat log run for real against an installed in-memory Storage.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { CompanionIdentity, VoicePosture } from '@shared/companion-types'
import {
  COMPANION_BEAT_LOG_KEY,
  COMPANION_MILESTONE_LOG_KEY,
  VOICE_POSTURE_STORAGE_KEY,
} from '@shared/companion-presence'

const apiMocks = vi.hoisted(() => ({
  fetchMemories: vi.fn(),
  fetchAccountStreak: vi.fn(),
  fetchEarliestMemoryTitle: vi.fn(),
  putVoicePosture: vi.fn(),
}))

vi.mock('@/lib/companion-api', () => ({
  fetchMemories: apiMocks.fetchMemories,
  fetchAccountStreak: apiMocks.fetchAccountStreak,
  fetchEarliestMemoryTitle: apiMocks.fetchEarliestMemoryTitle,
  putVoicePosture: apiMocks.putVoicePosture,
}))
// Flag OFF — the honesty path (the lobby never touches the mic; the talk button
// carries the honest note). Mocked per file so each suite tests its own path.
vi.mock('./lobby-voice', () => ({
  LOBBY_VOICE_CAPABLE: false,
  LOBBY_VOICE_NOTE: '语音陪伴在拆弹局内可用，进入每日挑战开启。',
}))

import CompanionPresence from './CompanionPresence'

const COMPANION: CompanionIdentity = {
  name: '阿澈',
  address_style: '',
  voice_id: 'companion-warm',
  profile_enabled: true,
  voice_posture: 'voice-default',
  created_at: '2026-06-30T00:00:00.000Z',
}

function withPosture(posture: VoicePosture): CompanionIdentity {
  return { ...COMPANION, voice_posture: posture }
}

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

function renderShell(companion: CompanionIdentity, path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <CompanionPresence context="shell" companion={companion} />
    </MemoryRouter>
  )
}

function renderInGame(companion: CompanionIdentity, path = '/leaderboard') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <CompanionPresence context="in-game" companion={companion} />
    </MemoryRouter>
  )
}

describe('CompanionPresence (lobby voice OFF)', () => {
  beforeEach(() => {
    vi.useRealTimers()
    installMemoryStorage()
    apiMocks.fetchMemories.mockReset()
    apiMocks.fetchMemories.mockResolvedValue({ kind: 'ok', memories: [] })
    apiMocks.fetchAccountStreak.mockReset()
    apiMocks.fetchAccountStreak.mockResolvedValue(0)
    apiMocks.fetchEarliestMemoryTitle.mockReset()
    apiMocks.fetchEarliestMemoryTitle.mockResolvedValue(null)
    apiMocks.putVoicePosture.mockReset()
    apiMocks.putVoicePosture.mockResolvedValue({ kind: 'ok' })
  })

  it('shell: lands the arrival greeting and NEVER touches the mic APIs while lobby voice is off', async () => {
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
    renderShell(COMPANION)

    const greetings = await screen.findAllByText(/上次最后三秒拆掉了炸弹，我还记着/)
    expect(greetings.length).toBeGreaterThan(0)
    expect(window.localStorage.getItem(COMPANION_BEAT_LOG_KEY)).toContain('"count":1')

    // The stub-era honesty pin: with lobby voice off no permission API is
    // touched, so a stub-era denial can never poison denied-remembered.
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(apiMocks.putVoicePosture).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(VOICE_POSTURE_STORAGE_KEY)).toBe('voice-default')
  })

  it('shell: fires the milestone beat once (account streak) with the early-episode callback (B20)', async () => {
    stubMic('granted')
    apiMocks.fetchAccountStreak.mockResolvedValue(7)
    apiMocks.fetchEarliestMemoryTitle.mockResolvedValue('连题目都没看完就开剪')
    renderShell(COMPANION)

    const beats = await screen.findAllByText('认识一周了。你第一天连题目都没看完就开剪，我还记得。')
    expect(beats.length).toBeGreaterThan(0)
    expect(screen.queryByText(/今天的每日挑战等你/)).not.toBeInTheDocument()

    await waitFor(() =>
      expect(window.localStorage.getItem(COMPANION_MILESTONE_LOG_KEY)).toContain('7')
    )
    expect(window.localStorage.getItem(COMPANION_BEAT_LOG_KEY)).toContain('"count":1')
    // The milestone path reads the EARLIEST episode for its callback.
    expect(apiMocks.fetchEarliestMemoryTitle).toHaveBeenCalled()
  })

  it('shell: the memory-hook slot draws a warm line from the most recent episode', async () => {
    // Rendered off-home so the arrival greeting does not occupy the line — the
    // memory hook then surfaces the recent episode.
    apiMocks.fetchMemories.mockResolvedValue({
      kind: 'ok',
      memories: [
        {
          id: 'ep-1',
          occurred_at: '2026-07-07T20:00:00.000Z',
          game_id: 'bombsquad',
          title: '卡在光弦',
          narrative: 'n',
        },
      ],
    })
    renderShell(COMPANION, '/leaderboard')
    await screen.findByText('还记得你上次卡在光弦。')
  })

  it('shell: the memory-hook slot shows the gentle first-meeting empty state', async () => {
    apiMocks.fetchMemories.mockResolvedValue({ kind: 'ok', memories: [] })
    renderShell(COMPANION, '/leaderboard')
    await screen.findByText('我们才刚认识。')
  })

  it('shell: the labeled talk button surfaces the honest note (no fake lobby voice)', async () => {
    const getUserMedia = stubMic('granted')
    renderShell(COMPANION, '/leaderboard')

    // Labeled ≥48px talk affordance, honest aria while lobby voice is off.
    fireEvent.click(screen.getByRole('button', { name: '语音陪伴说明' }))
    await screen.findByText('语音陪伴在拆弹局内可用，进入每日挑战开启。')
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(apiMocks.putVoicePosture).not.toHaveBeenCalled()
  })

  it('shell: lands muted with no greeting / no memory-hook fetch for a quiet-remembered visit', () => {
    const getUserMedia = stubMic('granted')
    renderShell(withPosture('quiet-remembered'))

    expect(screen.getByText('阿澈')).toBeInTheDocument()
    expect(screen.getByText('静音中')).toBeInTheDocument()
    expect(getUserMedia).not.toHaveBeenCalled()
    // Muted → the beat AND the memory hook stay quiet (no album read).
    expect(apiMocks.fetchMemories).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '语音陪伴说明' })).toBeInTheDocument()
  })

  it('in-game: mic button surfaces the honest note instead of faking lobby voice', async () => {
    const getUserMedia = stubMic('granted')
    renderInGame(COMPANION)

    fireEvent.click(screen.getByRole('button', { name: '语音陪伴说明' }))
    await screen.findByText('语音陪伴在拆弹局内可用，进入每日挑战开启。')
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(apiMocks.putVoicePosture).not.toHaveBeenCalled()
  })

  it('in-game: mutes from the control menu and persists quiet-remembered', async () => {
    stubMic('granted')
    renderInGame(COMPANION)

    fireEvent.click(screen.getByRole('button', { name: '阿澈 控制菜单' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '静音' }))

    expect(screen.getByText('阿澈在这（静音中）')).toBeInTheDocument()
    await waitFor(() => expect(apiMocks.putVoicePosture).toHaveBeenCalledWith('quiet-remembered'))
    expect(window.localStorage.getItem(VOICE_POSTURE_STORAGE_KEY)).toBe('quiet-remembered')

    fireEvent.click(screen.getByRole('button', { name: '阿澈 控制菜单' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '恢复自动语音' }))
    await waitFor(() => expect(apiMocks.putVoicePosture).toHaveBeenCalledWith('voice-default'))
    expect(screen.getByText('阿澈在这')).toBeInTheDocument()
  })

  it('in-game: fires no greeting away from the homepage', () => {
    stubMic('granted')
    renderInGame(COMPANION, '/community')

    expect(apiMocks.fetchMemories).not.toHaveBeenCalled()
    expect(screen.getByText('阿澈在这')).toBeInTheDocument()
  })
})
