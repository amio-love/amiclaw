// SessionProvider — React Context that owns the 5-screen flow's shared state.
// Persistence: thin sessionStorage stub so dev-stage 5-screen click-through
// survives a browser refresh. NOT production persistence — no KV / localStorage
// (per IA Boundary: "sessionStorage 失败-恢复 (不持久化 KV / localStorage)").
// The `-v1` suffix on STORAGE_KEY is forward-looking; no migration logic yet.

import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { YaoSextet } from '../glyphs/utils'
import type { ColdReadingPhase, ProjArtId, SessionContextValue, VoiceState } from './types'

export const SessionContext = createContext<SessionContextValue | null>(null)

const STORAGE_KEY = 'amiclaw-yijing-session-v1'

interface StoredSession {
  picked: ProjArtId[]
  yaoValues: YaoSextet | null
  castCreatedAt?: string | null
  phase: ColdReadingPhase
  voiceState: VoiceState
  sessionId: string
}

/** Read + JSON-parse the stored session blob. Returns null on missing key,
 *  parse error, or shape mismatch — caller falls back to fresh defaults.
 *  Validation is shallow on purpose: this is a dev-only refresh stub, not a
 *  production deserialization boundary. */
function loadStored(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    return parsed as StoredSession
  } catch {
    return null
  }
}

interface SessionProviderProps {
  children: ReactNode
}

export function SessionProvider({ children }: SessionProviderProps) {
  const [picked, setPicked] = useState<ProjArtId[]>(() => loadStored()?.picked ?? [])
  const [yaoValues, setYaoValuesState] = useState<YaoSextet | null>(
    () => loadStored()?.yaoValues ?? null
  )
  const [castCreatedAt, setCastCreatedAt] = useState<string | null>(
    () => loadStored()?.castCreatedAt ?? null
  )
  const [phase, setPhaseState] = useState<ColdReadingPhase>(() => loadStored()?.phase ?? 0)
  const [voiceState, setVoiceStateState] = useState<VoiceState>(
    () => loadStored()?.voiceState ?? 'idle'
  )
  const [sessionId, setSessionId] = useState<string>(
    () => loadStored()?.sessionId ?? crypto.randomUUID()
  )

  const pickImage = useCallback((id: ProjArtId) => {
    setPicked((prev) => (prev.length < 2 ? [...prev, id] : [prev[1], id]))
  }, [])

  const clearPicks = useCallback(() => setPicked([]), [])

  const setYaoValues = useCallback((values: YaoSextet) => {
    setYaoValuesState(values)
    setCastCreatedAt(new Date().toISOString())
  }, [])

  const setPhase = useCallback((next: ColdReadingPhase) => {
    setPhaseState(next)
  }, [])

  const setVoiceState = useCallback((next: VoiceState) => {
    setVoiceStateState(next)
  }, [])

  const reset = useCallback(() => {
    // Clear first so a refresh between removeItem and the post-render persist
    // useEffect (e.g. user manually reloads inside the same tick) sees no stale
    // state. The subsequent setState calls schedule a re-render whose useEffect
    // re-persists the fresh initial state — both removeItem and the setters are
    // synchronous in this event-loop turn, so no observable race.
    try {
      sessionStorage.removeItem(STORAGE_KEY)
    } catch {
      // Swallow — storage may be unavailable; in-memory reset still proceeds.
    }
    setPicked([])
    setYaoValuesState(null)
    setCastCreatedAt(null)
    setPhaseState(0)
    setVoiceStateState('idle')
    setSessionId(crypto.randomUUID())
  }, [])

  // Persist any state change. Quota / serialization failures are swallowed —
  // the in-memory session is the source of truth; sessionStorage is a hint.
  useEffect(() => {
    try {
      const snapshot: StoredSession = {
        picked,
        yaoValues,
        castCreatedAt,
        phase,
        voiceState,
        sessionId,
      }
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
    } catch {
      // Swallow — full quota, disabled storage, serialization failure.
    }
  }, [picked, yaoValues, castCreatedAt, phase, voiceState, sessionId])

  const value = useMemo<SessionContextValue>(
    () => ({
      picked,
      yaoValues,
      castCreatedAt,
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
      castCreatedAt,
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
