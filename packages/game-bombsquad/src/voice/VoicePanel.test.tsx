import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GameState, ManualData } from '@amiclaw/platform-ai/contract'
import type { UseVoiceSessionResult } from './useVoiceSession'
import VoicePanel from './VoicePanel'

// Mock the hook so the panel can be driven through every status / phase without a
// real WebSocket, mic, or AudioContext (those are the browser-only play-green).
vi.mock('./useVoiceSession', () => ({ useVoiceSession: vi.fn() }))
import { useVoiceSession } from './useVoiceSession'
const mockHook = vi.mocked(useVoiceSession)

const endSession = vi.fn()

function hookState(partial: Partial<UseVoiceSessionResult> = {}): UseVoiceSessionResult {
  return {
    status: 'ready',
    conversationPhase: 'listening',
    playerSpeaking: false,
    aiText: '',
    playerTranscript: '',
    isAiSpeaking: false,
    error: null,
    summary: null,
    endSession,
    ...partial,
  }
}

const manualData: ManualData = { version: 'v1', sections: { button: { rule: 'hold' } } }
const gameState: GameState = { relevantSections: ['button'] }

function renderPanel(partial: Partial<UseVoiceSessionResult> = {}) {
  mockHook.mockReturnValue(hookState(partial))
  return render(<VoicePanel manualData={manualData} gameState={gameState} />)
}

beforeEach(() => {
  mockHook.mockReset()
  endSession.mockReset()
})

describe('VoicePanel — connection status (non-live)', () => {
  it('shows the connecting status', () => {
    renderPanel({ status: 'connecting' })
    expect(screen.getByText('连接中')).toBeInTheDocument()
  })

  it('shows the connection-error status', () => {
    renderPanel({ status: 'error', error: 'voice connection closed (1006)' })
    expect(screen.getByText('连接出错')).toBeInTheDocument()
  })

  it('shows the ended status when closed', () => {
    renderPanel({ status: 'closed' })
    expect(screen.getByText('已结束')).toBeInTheDocument()
  })
})

describe('VoicePanel — live 3-state conversation phase', () => {
  it('shows 聆听中 while listening', () => {
    renderPanel({ status: 'ready', conversationPhase: 'listening' })
    expect(screen.getByText('聆听中')).toBeInTheDocument()
  })

  it('shows 思考中 while thinking', () => {
    renderPanel({ status: 'ready', conversationPhase: 'thinking' })
    expect(screen.getByText('思考中')).toBeInTheDocument()
  })

  it('shows 说话中 while speaking', () => {
    renderPanel({ status: 'ready', conversationPhase: 'speaking', isAiSpeaking: true })
    expect(screen.getByText('说话中')).toBeInTheDocument()
  })

  it('does not show a phase label before the session is live', () => {
    renderPanel({ status: 'connecting', conversationPhase: 'listening' })
    expect(screen.queryByText('聆听中')).not.toBeInTheDocument()
  })
})

describe('VoicePanel — cues and content', () => {
  it('renders the accumulated AI text', () => {
    renderPanel({ aiText: 'Hold the button.' })
    expect(screen.getByText('Hold the button.')).toBeInTheDocument()
  })

  it('renders the player subtitle (their own recognized speech) labeled 你：', () => {
    renderPanel({ playerTranscript: '红色还是蓝色的线' })
    const subtitle = screen.getByLabelText('你说的话')
    expect(subtitle).toHaveTextContent('你：红色还是蓝色的线')
  })

  it('renders nothing for an empty player transcript', () => {
    renderPanel({ playerTranscript: '' })
    expect(screen.queryByLabelText('你说的话')).not.toBeInTheDocument()
  })

  it('streams the player subtitle live and replaces it for a new utterance (no append)', () => {
    // The panel is memoized; in the real app a hook-state change re-renders it.
    // Pass a fresh (equal) prop object per rerender to force that re-render so the
    // mocked hook's new value is read — simulating successive `transcript` frames.
    const props = () => ({ manualData: { ...manualData }, gameState: { ...gameState } })

    mockHook.mockReturnValue(hookState({ playerTranscript: '红' }))
    const { rerender } = render(<VoicePanel {...props()} />)
    expect(screen.getByLabelText('你说的话')).toHaveTextContent('你：红')

    // An interim grows: the subtitle builds up to the latest cumulative text.
    mockHook.mockReturnValue(hookState({ playerTranscript: '红色的线' }))
    rerender(<VoicePanel {...props()} />)
    expect(screen.getByLabelText('你说的话')).toHaveTextContent('你：红色的线')

    // The next utterance's first interim replaces the prior subtitle, not appends.
    mockHook.mockReturnValue(hookState({ playerTranscript: '第' }))
    rerender(<VoicePanel {...props()} />)
    const subtitle = screen.getByLabelText('你说的话')
    expect(subtitle).toHaveTextContent('你：第')
    expect(subtitle).not.toHaveTextContent('红色的线')
  })

  it('shows the speaking-bars cue while the AI is speaking and live', () => {
    const { container } = renderPanel({
      status: 'ready',
      conversationPhase: 'speaking',
      isAiSpeaking: true,
    })
    expect(container.querySelector('[aria-label="AI 正在说话"]')).toBeInTheDocument()
  })

  it('hides the speaking cue when the AI is not speaking', () => {
    const { container } = renderPanel({ isAiSpeaking: false })
    expect(container.querySelector('[aria-label="AI 正在说话"]')).not.toBeInTheDocument()
  })

  it('shows a bounded error line as an alert', () => {
    renderPanel({ error: 'microphone permission denied' })
    expect(screen.getByRole('alert')).toHaveTextContent('microphone permission denied')
  })
})

describe('VoicePanel — hands-free (no push-to-talk)', () => {
  it('renders no push-to-talk button', () => {
    renderPanel({ status: 'ready' })
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows the hands-free hint', () => {
    renderPanel({ status: 'ready' })
    expect(screen.getByText(/免提对话已开启/)).toBeInTheDocument()
  })
})
