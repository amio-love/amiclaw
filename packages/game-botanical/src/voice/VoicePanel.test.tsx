import { render, screen, fireEvent } from '@testing-library/react'
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
const sendText = vi.fn()

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
    sendText,
    ...partial,
  }
}

const manualData: ManualData = { version: '1.1.0', sections: { objective: { lines: [] } } }
const gameState: GameState = { relevantSections: ['objective'] }

function renderPanel(partial: Partial<UseVoiceSessionResult> = {}) {
  mockHook.mockReturnValue(hookState(partial))
  return render(<VoicePanel manualData={manualData} gameState={gameState} />)
}

beforeEach(() => {
  mockHook.mockReset()
  endSession.mockReset()
  sendText.mockReset()
})

describe('VoicePanel — status + 3-state phase', () => {
  it('shows the connecting status before live', () => {
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
