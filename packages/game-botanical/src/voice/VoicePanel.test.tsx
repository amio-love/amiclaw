import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type {
  GameVoiceManualData,
  GameVoiceState,
  UseGameVoiceSessionResult,
} from '@shared/voice/use-game-voice-session'
import VoicePanel from './VoicePanel'

// Mock the shared game-voice hook so the panel can be driven through every status
// / phase without a real WebSocket, mic, or AudioContext (browser-only play-green).
vi.mock('@shared/voice/use-game-voice-session', () => ({ useGameVoiceSession: vi.fn() }))
import { useGameVoiceSession } from '@shared/voice/use-game-voice-session'
const mockHook = vi.mocked(useGameVoiceSession)

const endSession = vi.fn()
const sendText = vi.fn()
const openSession = vi.fn()

function hookState(partial: Partial<UseGameVoiceSessionResult> = {}): UseGameVoiceSessionResult {
  return {
    status: 'ready',
    conversationPhase: 'listening',
    playerSpeaking: false,
    aiText: '',
    playerTranscript: '',
    isAiSpeaking: false,
    error: null,
    errorCode: null,
    summary: null,
    openSession,
    closeSession: vi.fn(),
    updateGameState: vi.fn(),
    sendText,
    endSession,
    requestClosing: vi.fn().mockResolvedValue(undefined),
    ...partial,
  }
}

const manualData: GameVoiceManualData = { version: '1.1.0', sections: { objective: { lines: [] } } }
const gameState: GameVoiceState = { relevantSections: ['objective'] }

function renderPanel(partial: Partial<UseGameVoiceSessionResult> = {}) {
  mockHook.mockReturnValue(hookState(partial))
  return render(<VoicePanel manualData={manualData} gameState={gameState} gameId="demo-mock" />)
}

beforeEach(() => {
  mockHook.mockReset()
  endSession.mockReset()
  sendText.mockReset()
  openSession.mockReset()
})

describe('VoicePanel — start gate (mic gesture)', () => {
  it('shows the 开始对话 button while idle and opens the session on click (user gesture)', () => {
    renderPanel({ status: 'idle' })
    fireEvent.click(screen.getByRole('button', { name: '开始对话' }))
    expect(openSession).toHaveBeenCalledOnce()
  })

  it('does not show the live 3-state UI before the session starts', () => {
    renderPanel({ status: 'idle' })
    expect(screen.queryByText('聆听中')).not.toBeInTheDocument()
  })
})

describe('VoicePanel — status + 3-state phase', () => {
  it('shows the connecting status after start, before live', () => {
    renderPanel({ status: 'connecting' })
    expect(screen.getByText('连接中')).toBeInTheDocument()
  })

  it('shows 聆听中 / 思考中 / 说话中 while live', () => {
    renderPanel({ status: 'ready', conversationPhase: 'listening' })
    expect(screen.getByText('聆听中')).toBeInTheDocument()
    renderPanel({ status: 'ready', conversationPhase: 'thinking' })
    expect(screen.getByText('思考中')).toBeInTheDocument()
    renderPanel({ status: 'ready', conversationPhase: 'speaking', isAiSpeaking: true })
    expect(screen.getByText('说话中')).toBeInTheDocument()
  })
})

describe('VoicePanel — botanist framing + content', () => {
  it('renders the AI reply labeled 植物学家：', () => {
    renderPanel({
      aiText: '先给兰花遮一次光，再浇水。',
      conversationPhase: 'speaking',
      isAiSpeaking: true,
    })
    const reply = screen.getByLabelText('植物学家说的话')
    expect(reply).toHaveTextContent('植物学家：先给兰花遮一次光，再浇水。')
  })

  it('renders the player subtitle labeled 你：', () => {
    renderPanel({ playerTranscript: '这株多肉能浇水吗' })
    expect(screen.getByLabelText('你说的话')).toHaveTextContent('你：这株多肉能浇水吗')
  })

  it('shows the speaking cue while the botanist is speaking', () => {
    const { container } = renderPanel({ conversationPhase: 'speaking', isAiSpeaking: true })
    expect(container.querySelector('[aria-label="植物学家正在说话"]')).toBeInTheDocument()
  })

  it('surfaces a bounded error as an alert', () => {
    renderPanel({ error: 'microphone permission denied' })
    expect(screen.getByRole('alert')).toHaveTextContent('microphone permission denied')
  })

  it('ends the session from the end-call control', () => {
    renderPanel({ status: 'ready' })
    fireEvent.click(screen.getByRole('button', { name: '结束对话' }))
    expect(endSession).toHaveBeenCalledOnce()
  })

  it('shows the hands-free botanist hint', () => {
    renderPanel({ status: 'ready' })
    expect(screen.getByText(/免提对话已开启/)).toBeInTheDocument()
  })

  it('wires the text fallback: a typed question calls sendText', () => {
    renderPanel({ status: 'ready' })
    const input = screen.getByLabelText('给植物学家的问题')
    fireEvent.change(input, { target: { value: '打字问一句' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    expect(sendText).toHaveBeenCalledWith('打字问一句')
  })
})
