// SessionProvider — React Context that owns the 5-screen flow's shared state.
// Scaffold scope: provider + actions only. Persistence (per handoff §8: KV vs
// localStorage) is an Open Question deferred to sibling 2 / backend.

import { createContext, useCallback, useMemo, useState, type ReactNode } from 'react'
import type { YaoSextet } from '../glyphs/utils'
import type { ColdReadingPhase, ProjArtId, SessionContextValue, VoiceState } from './types'

export const SessionContext = createContext<SessionContextValue | null>(null)

interface SessionProviderProps {
  children: ReactNode
}

export function SessionProvider({ children }: SessionProviderProps) {
  const [picked, setPicked] = useState<ProjArtId[]>([])
  const [yaoValues, setYaoValuesState] = useState<YaoSextet | null>(null)
  const [phase, setPhaseState] = useState<ColdReadingPhase>(0)
  const [voiceState, setVoiceStateState] = useState<VoiceState>('idle')
  const [sessionId, setSessionId] = useState<string>(() => crypto.randomUUID())

  const pickImage = useCallback((id: ProjArtId) => {
    setPicked((prev) => (prev.length < 2 ? [...prev, id] : [prev[1], id]))
  }, [])

  const clearPicks = useCallback(() => setPicked([]), [])

  const setYaoValues = useCallback((values: YaoSextet) => {
    setYaoValuesState(values)
  }, [])

  const setPhase = useCallback((next: ColdReadingPhase) => {
    setPhaseState(next)
  }, [])

  const setVoiceState = useCallback((next: VoiceState) => {
    setVoiceStateState(next)
  }, [])

  const reset = useCallback(() => {
    setPicked([])
    setYaoValuesState(null)
    setPhaseState(0)
    setVoiceStateState('idle')
    setSessionId(crypto.randomUUID())
  }, [])

  const value = useMemo<SessionContextValue>(
    () => ({
      picked,
      yaoValues,
      phase,
      voiceState,
      sessionId,
      pickImage,
      clearPicks,
      setYaoValues,
      setPhase,
      setVoiceState,
      reset,
    }),
    [
      picked,
      yaoValues,
      phase,
      voiceState,
      sessionId,
      pickImage,
      clearPicks,
      setYaoValues,
      setPhase,
      setVoiceState,
      reset,
    ]
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
