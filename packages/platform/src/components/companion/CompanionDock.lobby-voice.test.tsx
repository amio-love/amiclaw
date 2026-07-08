/**
 * CompanionDock — the ratified auto-voice-on-login sequence, pinned FLAG-ON.
 *
 * `LOBBY_VOICE_CAPABLE` is module-mocked to true here so the full design
 * sequence (§自动语音登录序列) stays live and regression-pinned for the slice
 * that ships the lobby voice channel and flips the flag: greeting text first
 * → 300ms → permission request → grant keeps voice-default / denial persists
 * `denied-remembered` (never auto-repeated; the mic button is the sole,
 * user-gesture retry whose grant corrects back to voice-default).
 *
 * The shipping (flag-off) behaviour — the lobby never touching mic APIs — is
 * pinned in CompanionDock.test.tsx.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { CompanionIdentity, VoicePosture } from '@shared/companion-types'
import { VOICE_POSTURE_STORAGE_KEY } from '@shared/companion-presence'

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
// The lobby voice session is mocked: `open` / `close` are spies, and `current`
// is the controllable hook state (a rerender re-reads it, so a test can simulate
// the channel going live + streaming a greeting).
const lobbyMock = vi.hoisted(() => ({
  current: {
    status: 'idle' as string,
    live: false,
    conversationPhase: 'listening' as string,
    aiText: '',
    isAiSpeaking: false,
  },
  open: vi.fn(),
  close: vi.fn(),
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
// Flip the capability: this file pins the sequence the next slice engages.
vi.mock('./lobby-voice', () => ({
  LOBBY_VOICE_CAPABLE: true,
  LOBBY_VOICE_NOTE: '语音陪伴在拆弹局内可用，进入每日挑战开启。',
}))
vi.mock('./useLobbyVoiceSession', () => ({
  useLobbyVoiceSession: () => ({
    ...lobbyMock.current,
    open: lobbyMock.open,
    close: lobbyMock.close,
  }),
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
    stats: { games_completed: 0, successes: 0 },
  }
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

function renderDock(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <CompanionDock />
    </MemoryRouter>
  )
}

describe('CompanionDock — auto-voice sequence (lobby voice capability ON)', () => {
  beforeEach(() => {
    vi.useRealTimers()
    installMemoryStorage()
    authState.current = { status: 'anon', user: null }
    companionState.current = { status: 'loading', companion: null }
    apiMocks.fetchMemories.mockReset()
    apiMocks.fetchMemories.mockResolvedValue({ kind: 'ok', memories: [] })
    apiMocks.putVoicePosture.mockReset()
    apiMocks.putVoicePosture.mockResolvedValue({ kind: 'ok' })
    lobbyMock.current = {
      status: 'idle',
      live: false,
      conversationPhase: 'listening',
      aiText: '',
      isAiSpeaking: false,
    }
    lobbyMock.open.mockReset()
    lobbyMock.close.mockReset()
  })

  it('greeting text lands BEFORE the mic request; grant keeps voice-default', async () => {
    signInWithCompanion()
    const getUserMedia = stubMic('granted')
    renderDock()

    // Text first — never blocked on the permission dialog.
    await screen.findAllByText('我在这。今天的每日挑战等你。')
    expect(getUserMedia).not.toHaveBeenCalled()

    // 300ms later the sequence requests the mic exactly once.
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1))
    // Grant: posture stays voice-default — nothing is persisted.
    expect(apiMocks.putVoicePosture).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(VOICE_POSTURE_STORAGE_KEY)).toBe('voice-default')
  })

  it('a REAL denial persists denied-remembered; the greeting text stays', async () => {
    signInWithCompanion()
    stubMic('denied')
    renderDock()

    await screen.findAllByText('我在这。今天的每日挑战等你。')
    await waitFor(() => expect(apiMocks.putVoicePosture).toHaveBeenCalledWith('denied-remembered'))
    expect(window.localStorage.getItem(VOICE_POSTURE_STORAGE_KEY)).toBe('denied-remembered')
    expect(screen.getAllByText('我在这。今天的每日挑战等你。').length).toBeGreaterThan(0)
  })

  it('denied-remembered never auto-requests; the mic button retry corrects on grant', async () => {
    signInWithCompanion('denied-remembered')
    const getUserMedia = stubMic('granted')
    renderDock()

    expect(screen.getByText('阿澈在这（静音中）')).toBeInTheDocument()
    expect(getUserMedia).not.toHaveBeenCalled()

    // Manual retry (user gesture): granted → posture corrects back to
    // voice-default and the dock elevates.
    fireEvent.click(screen.getByRole('button', { name: '开启语音' }))
    await waitFor(() => expect(apiMocks.putVoicePosture).toHaveBeenCalledWith('voice-default'))
    expect(window.localStorage.getItem(VOICE_POSTURE_STORAGE_KEY)).toBe('voice-default')
    await screen.findByText('阿澈在这')
  })

  it('a failed posture PUT rolls the cache back (cheap durability)', async () => {
    signInWithCompanion()
    stubMic('granted')
    apiMocks.putVoicePosture.mockResolvedValue({ kind: 'error' })
    renderDock('/leaderboard')

    fireEvent.click(screen.getByRole('button', { name: '阿澈 控制菜单' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '静音' }))

    // This visit still mutes (session behaviour honoured)…
    expect(screen.getByText('阿澈在这（静音中）')).toBeInTheDocument()
    // …but the cache never claims a posture the account did not accept.
    await waitFor(() =>
      expect(window.localStorage.getItem(VOICE_POSTURE_STORAGE_KEY)).toBe('voice-default')
    )
  })

  it('step 4 — GRANT opens the lobby voice session, reusing the granted stream', async () => {
    signInWithCompanion()
    stubMic('granted')
    renderDock()

    await screen.findAllByText('我在这。今天的每日挑战等你。')
    // After the 300ms probe grants, the lobby session opens with the granted
    // stream (no second mic prompt — the stream is handed straight to open()).
    await waitFor(() => expect(lobbyMock.open).toHaveBeenCalledTimes(1))
    expect(lobbyMock.open).toHaveBeenCalledWith(
      expect.objectContaining({ getTracks: expect.any(Function) })
    )
  })

  it('Option B — the live streamed greeting drives the dock bubble (subtitle)', async () => {
    signInWithCompanion()
    stubMic('granted')
    const { rerender } = renderDock()

    // The instant client greeting lands first.
    await screen.findAllByText('我在这。今天的每日挑战等你。')

    // The voice channel goes live and streams the memory-grounded greeting; the
    // bubble becomes its live subtitle (replacing the instant text).
    await act(async () => {
      lobbyMock.current = {
        status: 'ready',
        live: true,
        conversationPhase: 'speaking',
        aiText: '嘿，又见面了，昨天那关你收尾很利落。',
        isAiSpeaking: true,
      }
      rerender(
        <MemoryRouter initialEntries={['/']}>
          <CompanionDock />
        </MemoryRouter>
      )
    })

    expect(screen.getAllByText('嘿，又见面了，昨天那关你收尾很利落。').length).toBeGreaterThan(0)
  })

  it('muting closes the live lobby channel (abrupt, no memory)', async () => {
    signInWithCompanion()
    stubMic('granted')
    renderDock()

    await screen.findAllByText('我在这。今天的每日挑战等你。')
    fireEvent.click(screen.getByRole('button', { name: '阿澈 控制菜单' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '静音' }))

    expect(lobbyMock.close).toHaveBeenCalled()
  })

  it('leaving the homepage tears the lobby channel down (homepage-scoped)', async () => {
    signInWithCompanion()
    stubMic('granted')
    // A non-homepage mount is off the lobby scope: the channel is closed.
    renderDock('/leaderboard')
    await waitFor(() => expect(lobbyMock.close).toHaveBeenCalled())
  })
})
