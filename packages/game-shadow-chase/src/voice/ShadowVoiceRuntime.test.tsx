import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createRunningState } from '../engine/rules'
import type { CompanionIntent, SimulationState } from '../engine/types'
import { ShadowVoiceRuntime } from './ShadowVoiceRuntime'

const voiceHarness = vi.hoisted(() => ({
  options: [] as Array<Record<string, unknown>>,
  openSession: vi.fn(),
  closeSession: vi.fn(),
  endSession: vi.fn(),
  result: {
    status: 'idle',
    conversationPhase: 'listening',
    playerTranscript: '',
    aiText: '',
    errorCode: null as string | null,
  },
}))

const eligibilityHarness = vi.hoisted(() => ({
  current: { status: 'eligible', companionName: '小影' } as Record<string, string>,
}))

vi.mock('@shared/voice/use-game-voice-session', () => ({
  SHADOW_CHASE_VOICE_GUARDS: {
    connectMs: 5_000,
    responseMs: 12_000,
    silenceMs: 30_000,
    maxPlayerTurns: 8,
    maxDurationMs: 180_000,
  },
  useGameVoiceSession: (options: Record<string, unknown>) => {
    voiceHarness.options.push(options)
    return {
      ...voiceHarness.result,
      openSession: voiceHarness.openSession,
      closeSession: voiceHarness.closeSession,
      endSession: voiceHarness.endSession,
    }
  },
}))

vi.mock('./voice-eligibility', () => ({
  useShadowVoiceEligibility: () => eligibilityHarness.current,
}))

function RuntimeHarness({
  state,
  phase = 'planning',
  strategy = 'support',
  onStrategy = vi.fn(),
}: {
  state: SimulationState
  phase?: 'planning' | 'running'
  strategy?: CompanionIntent
  onStrategy?: (intent: CompanionIntent) => void
}) {
  return (
    <ShadowVoiceRuntime
      state={state}
      phase={phase}
      activeStrategy={strategy}
      onStrategy={onStrategy}
    >
      {(voice) => (
        <div>
          <span>{voice.status}</span>
          {voice.start && <button onClick={voice.start}>start voice</button>}
          {voice.stop && <button onClick={voice.stop}>stop voice</button>}
          {voice.statusMessage && <p>{voice.statusMessage}</p>}
        </div>
      )}
    </ShadowVoiceRuntime>
  )
}

function latestOptions(): Record<string, unknown> {
  const options = voiceHarness.options.at(-1)
  if (!options) throw new Error('voice hook was not called')
  return options
}

describe('Shadow voice production runtime', () => {
  beforeEach(() => {
    voiceHarness.options.length = 0
    voiceHarness.openSession.mockReset()
    voiceHarness.closeSession.mockReset()
    voiceHarness.endSession.mockReset()
    Object.assign(voiceHarness.result, {
      status: 'idle',
      conversationPhase: 'listening',
      playerTranscript: '',
      aiText: '',
      errorCode: null,
    })
    eligibilityHarness.current = { status: 'eligible', companionName: '小影' }
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  })

  it('configures one explicit-open shared session with exact Shadow context', () => {
    const state = createRunningState('courtyard', 'standard', 7)
    render(<RuntimeHarness state={state} strategy="scout" />)

    const options = latestOptions()
    expect(options).toMatchObject({
      autoConnect: false,
      gameId: 'shadow-chase',
      sessionNamePrefix: 'shadow-chase',
      opening: true,
      gameRunId: state.runId,
      guards: {
        connectMs: 5_000,
        responseMs: 12_000,
        silenceMs: 30_000,
        maxPlayerTurns: 8,
        maxDurationMs: 180_000,
      },
      gameState: {
        relevantSections: ['shadow-chase-rules'],
        publicContext: {
          version: 1,
          phase: 'planning',
          strategy: 'scout',
          allowedStrategies: ['support', 'scout', 'anchor'],
        },
      },
    })
    expect(voiceHarness.openSession).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'start voice' }))
    expect(voiceHarness.openSession).toHaveBeenCalledTimes(1)
  })

  it('does not expose a mic or socket start path when preflight is ineligible', () => {
    eligibilityHarness.current = { status: 'ineligible', reason: 'anonymous' }
    render(<RuntimeHarness state={createRunningState('courtyard', 'standard', 7)} />)

    expect(screen.queryByRole('button', { name: 'start voice' })).toBeNull()
    expect(screen.getByText(/登录并创建伙伴/)).toBeTruthy()
    expect(voiceHarness.openSession).not.toHaveBeenCalled()
  })

  it('allows an eligible player to start voice while already running', () => {
    render(
      <RuntimeHarness state={createRunningState('courtyard', 'standard', 7)} phase="running" />
    )

    fireEvent.click(screen.getByRole('button', { name: 'start voice' }))
    expect(voiceHarness.openSession).toHaveBeenCalledTimes(1)
  })

  it('derives commands only from each final player transcript', () => {
    const onStrategy = vi.fn()
    render(
      <RuntimeHarness
        state={createRunningState('courtyard', 'standard', 7)}
        onStrategy={onStrategy}
      />
    )
    const deliver = latestOptions().onFinalTranscript as (utterance: {
      sequence: number
      text: string
    }) => void

    act(() => deliver({ sequence: 4, text: '去光核探路' }))
    act(() => deliver({ sequence: 4, text: '去远处架点' }))
    expect(onStrategy).toHaveBeenCalledTimes(1)
    expect(onStrategy).toHaveBeenCalledWith('scout')
  })

  it('maps bounded errors to Chinese while deterministic controls remain available', () => {
    Object.assign(voiceHarness.result, {
      status: 'error',
      errorCode: 'connect-timeout',
    })
    render(<RuntimeHarness state={createRunningState('courtyard', 'standard', 7)} />)

    expect(screen.getByText('error')).toBeTruthy()
    expect(screen.getByText('语音连接超时，策略按钮仍可使用。')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'start voice' })).toBeTruthy()
  })

  it('closes on hide and reopens in running only after one explicit gesture', () => {
    Object.assign(voiceHarness.result, { status: 'ready' })
    const state = createRunningState('courtyard', 'standard', 7)
    const view = render(<RuntimeHarness state={state} phase="running" />)
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })

    act(() => document.dispatchEvent(new Event('visibilitychange')))

    expect(voiceHarness.closeSession).toHaveBeenCalledTimes(1)
    expect(voiceHarness.openSession).not.toHaveBeenCalled()
    Object.assign(voiceHarness.result, { status: 'closed' })
    view.rerender(<RuntimeHarness state={state} phase="running" />)
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(voiceHarness.openSession).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'start voice' }))
    expect(voiceHarness.openSession).toHaveBeenCalledTimes(1)
  })

  it('offers an explicit reopen after manual stop', () => {
    Object.assign(voiceHarness.result, { status: 'ready' })
    const state = createRunningState('courtyard', 'standard', 7)
    const view = render(<RuntimeHarness state={state} phase="running" />)

    fireEvent.click(screen.getByRole('button', { name: 'stop voice' }))
    expect(voiceHarness.closeSession).toHaveBeenCalledTimes(1)
    Object.assign(voiceHarness.result, { status: 'closed' })
    view.rerender(<RuntimeHarness state={state} phase="running" />)
    fireEvent.click(screen.getByRole('button', { name: 'start voice' }))
    expect(voiceHarness.openSession).toHaveBeenCalledTimes(1)
  })

  it('requests terminal end exactly once across terminal render and unmount', () => {
    const running = createRunningState('courtyard', 'standard', 7)
    const view = render(<RuntimeHarness state={running} />)
    const terminal: SimulationState = { ...running, phase: 'loss' }

    view.rerender(<RuntimeHarness state={terminal} />)
    expect(voiceHarness.endSession).toHaveBeenCalledTimes(1)
    view.unmount()
    expect(voiceHarness.endSession).toHaveBeenCalledTimes(1)
  })
})
