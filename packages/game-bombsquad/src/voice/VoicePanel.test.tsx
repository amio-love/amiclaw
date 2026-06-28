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
