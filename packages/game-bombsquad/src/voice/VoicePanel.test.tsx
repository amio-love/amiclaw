import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GameState, ManualData } from '@amiclaw/platform-ai/contract'
import type { UseVoiceSessionResult } from './useVoiceSession'
import VoicePanel from './VoicePanel'

// Mock the hook so the panel can be driven through every status / cue without a
// real WebSocket, mic, or AudioContext (those are the browser-only play-green).
vi.mock('./useVoiceSession', () => ({ useVoiceSession: vi.fn() }))
import { useVoiceSession } from './useVoiceSession'
const mockHook = vi.mocked(useVoiceSession)

const startTalking = vi.fn()
const stopTalking = vi.fn()
const endSession = vi.fn()

function hookState(partial: Partial<UseVoiceSessionResult> = {}): UseVoiceSessionResult {
  return {
    status: 'ready',
    aiText: '',
    isAiSpeaking: false,
    error: null,
    summary: null,
    startTalking,
    stopTalking,
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
  startTalking.mockReset()
  stopTalking.mockReset()
  endSession.mockReset()
})

describe('VoicePanel — status rendering', () => {
  it('shows the connecting status with the talk control disabled', () => {
    renderPanel({ status: 'connecting' })
    expect(screen.getByText('连接中')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '按住说话' })).toBeDisabled()
  })

  it('enables push-to-talk once ready', () => {
    renderPanel({ status: 'ready' })
    expect(screen.getByText('已连接')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '按住说话' })).toBeEnabled()
  })

  it('surfaces the connection-error status', () => {
    renderPanel({ status: 'error', error: 'voice connection closed (1006)' })
    expect(screen.getByText('连接出错')).toBeInTheDocument()
  })
})

describe('VoicePanel — hook-state cues', () => {
  it('renders the accumulated AI text', () => {
    renderPanel({ aiText: 'Hold the button.' })
    expect(screen.getByText('Hold the button.')).toBeInTheDocument()
  })

  it('shows the "AI is speaking" cue while speaking', () => {
    renderPanel({ isAiSpeaking: true })
    expect(screen.getByText('AI 正在回应')).toBeInTheDocument()
  })

  it('hides the "AI is speaking" cue when not speaking', () => {
    renderPanel({ isAiSpeaking: false })
    expect(screen.queryByText('AI 正在回应')).not.toBeInTheDocument()
  })

  it('shows a bounded error line as an alert', () => {
    renderPanel({ error: 'microphone permission denied' })
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('microphone permission denied')
  })
})

describe('VoicePanel — push-to-talk wiring', () => {
  it('starts talking on press and stops on release', () => {
    renderPanel({ status: 'ready' })
    const btn = screen.getByRole('button', { name: /说话|结束/ })

    fireEvent.pointerDown(btn)
    expect(startTalking).toHaveBeenCalledTimes(1)

    fireEvent.pointerUp(btn)
    expect(stopTalking).toHaveBeenCalledTimes(1)
  })

  it('does not call stopTalking on a release that never began a hold', () => {
    renderPanel({ status: 'ready' })
    const btn = screen.getByRole('button', { name: '按住说话' })
    fireEvent.pointerUp(btn)
    expect(stopTalking).not.toHaveBeenCalled()
  })
})
