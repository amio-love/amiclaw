import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import {
  SHADOW_CHASE_VOICE_GUARDS,
  useGameVoiceSession,
  type GameVoiceErrorCode,
} from '@shared/voice/use-game-voice-session'

import type { CompanionIntent, SimulationState } from '../engine/types'
import { classifyStrategyCommand, type StrategyCommandResult } from './strategy-command'
import { buildShadowChaseVoiceState, SHADOW_CHASE_VOICE_MANUAL } from './shadow-chase-context'
import type { ShadowVoiceStatus, ShadowVoiceView } from './useShadowChaseVoice'
import { useShadowVoiceEligibility } from './voice-eligibility'

const ERROR_COPY: Record<GameVoiceErrorCode, string> = {
  'connect-timeout': '语音连接超时，策略按钮仍可使用。',
  'response-timeout': '伙伴回应超时，策略按钮仍可使用。',
  'silence-timeout': '长时间没有对话，本局语音已结束。',
  'turn-limit': '本局语音回合已用完，策略按钮仍可使用。',
  'duration-limit': '本局语音时长已用完，策略按钮仍可使用。',
  microphone: '麦克风不可用，已切换为按钮模式。',
  transport: '语音连接中断，策略按钮仍可使用。',
  server: '语音服务暂不可用，策略按钮仍可使用。',
  'insufficient-balance': '星芒不足，先去赚一些再和伙伴对话吧，策略按钮仍可使用。',
}

function mappedStatus(
  eligibility: ReturnType<typeof useShadowVoiceEligibility>,
  status: ReturnType<typeof useGameVoiceSession>['status'],
  conversationPhase: ReturnType<typeof useGameVoiceSession>['conversationPhase']
): ShadowVoiceStatus {
  if (eligibility.status === 'checking') return 'checking'
  if (eligibility.status !== 'eligible') return 'unavailable'
  if (status === 'idle') return 'available'
  if (status === 'connecting') return 'connecting'
  if (status === 'error') return 'error'
  if (status === 'closed') return 'closed'
  return conversationPhase
}

export function ShadowVoiceRuntime({
  state,
  phase,
  activeStrategy,
  onStrategy,
  children,
}: {
  state: SimulationState
  phase: 'planning' | 'running'
  activeStrategy: CompanionIntent
  onStrategy(intent: CompanionIntent): void
  children(voice: ShadowVoiceView): ReactNode
}) {
  const eligibility = useShadowVoiceEligibility(true)
  const gameState = buildShadowChaseVoiceState(state, phase, activeStrategy)
  const latestGameState = useRef(gameState)
  useLayoutEffect(() => {
    latestGameState.current = gameState
  }, [gameState])
  const lastFinalSequence = useRef<number | null>(null)
  const [commandResult, setCommandResult] = useState<StrategyCommandResult | null>(null)

  const handleFinalTranscript = useCallback(
    (utterance: { sequence: number; text: string }) => {
      if (lastFinalSequence.current === utterance.sequence) return
      lastFinalSequence.current = utterance.sequence
      const result = classifyStrategyCommand(utterance.text)
      setCommandResult(result)
      if (result.kind === 'command') onStrategy(result.intent)
    },
    [onStrategy]
  )

  const session = useGameVoiceSession({
    autoConnect: false,
    gameId: 'shadow-chase',
    sessionNamePrefix: 'shadow-chase',
    opening: true,
    guards: SHADOW_CHASE_VOICE_GUARDS,
    gameRunId: state.runId,
    manualData: SHADOW_CHASE_VOICE_MANUAL,
    gameState,
    getGameState: () => latestGameState.current,
    onFinalTranscript: handleFinalTranscript,
  })
  const { closeSession, endSession, openSession } = session
  const endSessionRef = useRef(endSession)
  useLayoutEffect(() => {
    endSessionRef.current = endSession
  }, [endSession])

  const endRequested = useRef(false)
  const endBestEffort = useCallback(() => {
    if (endRequested.current) return
    endRequested.current = true
    endSessionRef.current()
  }, [])

  useEffect(() => {
    if (state.phase !== 'running') endBestEffort()
  }, [endBestEffort, state.phase])

  useLayoutEffect(() => () => endBestEffort(), [endBestEffort])

  useEffect(() => {
    const stopOnHide = () => {
      if (document.hidden) closeSession()
    }
    document.addEventListener('visibilitychange', stopOnHide)
    return () => document.removeEventListener('visibilitychange', stopOnHide)
  }, [closeSession])

  const status = mappedStatus(eligibility, session.status, session.conversationPhase)
  const eligibilityMessage =
    eligibility.status === 'ineligible'
      ? eligibility.reason === 'anonymous'
        ? '登录并创建伙伴后可以开启语音；策略按钮始终可用。'
        : eligibility.reason === 'no-companion'
          ? '创建 AI 伙伴后可以开启语音；策略按钮始终可用。'
          : '暂时无法确认语音资格；策略按钮始终可用。'
      : undefined
  const voice: ShadowVoiceView = {
    status,
    playerTranscript: session.playerTranscript,
    companionText: session.aiText,
    commandResult,
    errorCode: session.errorCode ?? undefined,
    statusMessage:
      (session.errorCode ? ERROR_COPY[session.errorCode] : undefined) ?? eligibilityMessage,
    ...(eligibility.status === 'eligible' &&
    (session.status === 'idle' || session.status === 'closed' || session.status === 'error')
      ? { start: () => openSession() }
      : {}),
    ...(session.status === 'connecting' || session.status === 'ready'
      ? { stop: closeSession }
      : {}),
  }

  return children(voice)
}
