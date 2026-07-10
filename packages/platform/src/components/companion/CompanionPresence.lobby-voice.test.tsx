/**
 * CompanionPresence — the ratified auto-voice-on-login sequence, pinned FLAG-ON.
 *
 * `LOBBY_VOICE_CAPABLE` is module-mocked to true so the full design sequence
 * (§自动语音登录序列) stays live and regression-pinned: greeting text first →
 * 300ms → permission request → grant keeps voice-default / denial persists
 * `denied-remembered` (never auto-repeated; the talk button is the sole,
 * user-gesture retry whose grant corrects back to voice-default). The shell
 * context is the home (pathname `/`) presence; the in-game context is the
 * off-home strip.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import type { CompanionIdentity, VoicePosture } from '@shared/companion-types'
import { VOICE_POSTURE_STORAGE_KEY } from '@shared/companion-presence'

const apiMocks = vi.hoisted(() => ({
  fetchMemories: vi.fn(),
  fetchAccountStreak: vi.fn(),
  fetchEarliestMemoryTitle: vi.fn(),
  putVoicePosture: vi.fn(),
}))
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

vi.mock('@/lib/companion-api', () => ({
  fetchMemories: apiMocks.fetchMemories,
  fetchAccountStreak: apiMocks.fetchAccountStreak,
  fetchEarliestMemoryTitle: apiMocks.fetchEarliestMemoryTitle,
  putVoicePosture: apiMocks.putVoicePosture,
}))
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

function renderShell(companion: CompanionIdentity) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <CompanionPresence context="shell" companion={companion} />
    </MemoryRouter>
  )
}

function renderInGame(companion: CompanionIdentity, path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <CompanionPresence context="in-game" companion={companion} />
    </MemoryRouter>
  )
}

describe('CompanionPresence — auto-voice sequence (lobby voice capability ON)', () => {
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

  it('shell: greeting text lands BEFORE the mic request; grant keeps voice-default', async () => {
    const getUserMedia = stubMic('granted')
    renderShell(COMPANION)

    await screen.findAllByText('我在这。今天的每日挑战等你。')
    expect(getUserMedia).not.toHaveBeenCalled()

    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1))
    expect(apiMocks.putVoicePosture).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(VOICE_POSTURE_STORAGE_KEY)).toBe('voice-default')
  })

  it('shell: a REAL denial persists denied-remembered; the greeting text stays', async () => {
    stubMic('denied')
    renderShell(COMPANION)

    await screen.findAllByText('我在这。今天的每日挑战等你。')
    await waitFor(() => expect(apiMocks.putVoicePosture).toHaveBeenCalledWith('denied-remembered'))
    expect(window.localStorage.getItem(VOICE_POSTURE_STORAGE_KEY)).toBe('denied-remembered')
    expect(screen.getAllByText('我在这。今天的每日挑战等你。').length).toBeGreaterThan(0)
  })

  it('shell: denied-remembered never auto-requests; the talk retry corrects on grant', async () => {
    const getUserMedia = stubMic('granted')
    renderShell(withPosture('denied-remembered'))

    expect(screen.getByText('静音中')).toBeInTheDocument()
    expect(getUserMedia).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '开启语音' }))
    await waitFor(() => expect(apiMocks.putVoicePosture).toHaveBeenCalledWith('voice-default'))
    expect(window.localStorage.getItem(VOICE_POSTURE_STORAGE_KEY)).toBe('voice-default')
    await screen.findByText('在这')
  })

  it('shell: step 4 — GRANT opens the lobby voice session, reusing the granted stream', async () => {
    stubMic('granted')
    renderShell(COMPANION)

    await screen.findAllByText('我在这。今天的每日挑战等你。')
    await waitFor(() => expect(lobbyMock.open).toHaveBeenCalledTimes(1))
    expect(lobbyMock.open).toHaveBeenCalledWith(
      expect.objectContaining({ getTracks: expect.any(Function) })
    )
  })

  it('shell: Option B — the live streamed greeting drives the presence subtitle', async () => {
    stubMic('granted')
    const { rerender } = renderShell(COMPANION)

    await screen.findAllByText('我在这。今天的每日挑战等你。')

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
          <CompanionPresence context="shell" companion={COMPANION} />
        </MemoryRouter>
      )
    })

    expect(screen.getAllByText('嘿，又见面了，昨天那关你收尾很利落。').length).toBeGreaterThan(0)
  })

  it('shell: muting closes the live lobby channel (abrupt, no memory)', async () => {
    stubMic('granted')
    renderShell(COMPANION)

    await screen.findAllByText('我在这。今天的每日挑战等你。')
    fireEvent.click(screen.getByRole('button', { name: '阿澈 控制菜单' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '静音' }))

    expect(lobbyMock.close).toHaveBeenCalled()
  })

  it('in-game: a failed posture PUT rolls the cache back (cheap durability)', async () => {
    stubMic('granted')
    apiMocks.putVoicePosture.mockResolvedValue({ kind: 'error' })
    renderInGame(COMPANION, '/leaderboard')

    fireEvent.click(screen.getByRole('button', { name: '阿澈 控制菜单' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '静音' }))

    expect(screen.getByText('阿澈在这（静音中）')).toBeInTheDocument()
    await waitFor(() =>
      expect(window.localStorage.getItem(VOICE_POSTURE_STORAGE_KEY)).toBe('voice-default')
    )
  })

  it('in-game: a mic tap on a non-homepage page opens a REAL lobby session, not fake state (F3)', async () => {
    renderInGame(withPosture('quiet-remembered'), '/me')

    expect(screen.getByText('阿澈在这（静音中）')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '开启语音' }))

    await waitFor(() => expect(lobbyMock.open).toHaveBeenCalledTimes(1))
    expect(screen.getByText('阿澈在这')).toBeInTheDocument()
  })

  it('in-game: leaving the page tears the lobby channel down (scene-scoped, any page)', async () => {
    function Navigator() {
      const navigate = useNavigate()
      return (
        <button type="button" onClick={() => navigate('/leaderboard')}>
          go-leaderboard
        </button>
      )
    }
    render(
      <MemoryRouter initialEntries={['/me']}>
        <CompanionPresence context="in-game" companion={withPosture('quiet-remembered')} />
        <Navigator />
      </MemoryRouter>
    )

    fireEvent.click(screen.getByRole('button', { name: '开启语音' }))
    await waitFor(() => expect(lobbyMock.open).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: 'go-leaderboard' }))
    await waitFor(() => expect(lobbyMock.close).toHaveBeenCalled())
  })
})
