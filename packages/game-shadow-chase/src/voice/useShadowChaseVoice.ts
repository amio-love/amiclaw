import { useEffect, useRef, useState } from 'react'

import type { CompanionIntent } from '../engine/types'
import { classifyStrategyCommand, type StrategyCommandResult } from './strategy-command'

export type ShadowVoiceStatus =
  | 'unavailable'
  | 'checking'
  | 'available'
  | 'ready'
  | 'connecting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'error'
  | 'closed'

export interface ShadowVoiceSource {
  status: ShadowVoiceStatus
  playerTranscript: string
  companionText: string
  finalPlayerUtterance?: { sequence: number; text: string }
  start?: () => void
  stop?: () => void
  errorCode?: string
  statusMessage?: string
  /** Terminal summary reason — `'balance-depleted'` when the session wound down
      because the starburst budget ran out mid-conversation (reward-economy §5),
      driving the companion farewell beat. */
  sessionReason?: string
}

export interface ShadowVoiceView extends ShadowVoiceSource {
  commandResult: StrategyCommandResult | null
}

const UNAVAILABLE: ShadowVoiceSource = {
  status: 'unavailable',
  playerTranscript: '',
  companionText: '',
}

export function useShadowChaseVoice(
  source: ShadowVoiceSource | null,
  onStrategy: (intent: CompanionIntent) => void
): ShadowVoiceView {
  const active = source ?? UNAVAILABLE
  const lastSequence = useRef<number | null>(null)
  const [commandResult, setCommandResult] = useState<StrategyCommandResult | null>(null)

  useEffect(() => {
    const utterance = active.finalPlayerUtterance
    if (!utterance || lastSequence.current === utterance.sequence) return
    lastSequence.current = utterance.sequence
    const result = classifyStrategyCommand(utterance.text)
    setCommandResult(result)
    if (result.kind === 'command') onStrategy(result.intent)
  }, [active.finalPlayerUtterance, onStrategy])

  return { ...active, commandResult }
}
