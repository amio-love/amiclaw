/**
 * Companion-presence orchestration for the 伙伴坞 (companion dock).
 *
 * Owns everything stateful behind the dock UI for a signed-in player whose
 * companion exists:
 *
 *  - voice-posture memory (account SSOT adopted on mount, localStorage cache
 *    mirrored on every write, `PUT /api/companion/settings` sync; a failed
 *    PUT rolls the cache back so cross-visit state never silently diverges
 *    from the account);
 *  - the auto-voice login sequence (design §自动语音登录序列): the arrival
 *    greeting TEXT lands first, the mic permission request follows 300ms
 *    later, a denial persists `denied-remembered` and is never auto-repeated
 *    — ACTIVE ONLY behind `LOBBY_VOICE_CAPABLE` (see `lobby-voice.ts`);
 *  - the arrival beat (节拍 1) — template fill from the most recent visible
 *    memory + the local arcade streak, gated by `canFireArrivalBeat`;
 *  - mute / restore / mic-button posture transitions (§控制面).
 *
 * KNOWN SLICE GAP — voice channel outside a game: the platform-ai provider
 * registry has no lobby/homepage gameId and the session `create` contract
 * requires a per-run manual, so no voice session can open on platform pages
 * yet. While `LOBBY_VOICE_CAPABLE` is false the lobby therefore NEVER touches
 * mic / permission APIs — no permission prompt in a context that cannot
 * deliver voice, so a stub-era denial can never poison `denied-remembered`
 * (that posture may only ever be written from a REAL denial in a
 * working-voice context). The mic button instead surfaces the honest
 * in-game-voice note. Flipping the flag engages the full ratified sequence.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import type { CompanionIdentity, VoicePosture } from '@shared/companion-types'
import {
  buildArrivalGreeting,
  canFireArrivalBeat,
  deriveDockStatus,
  readBeatLog,
  readCachedVoicePosture,
  recordBeatFired,
  transitionPosture,
  writeBeatLog,
  writeCachedVoicePosture,
  type DockStatus,
  type PostureEvent,
} from '@shared/companion-presence'
import { getTodayString } from '@shared/date'
import { readArcadeLocalProfile, summarizeArcadeLocalProfile } from '@amiclaw/arcade-profile/local'
import { fetchMemories, putVoicePosture } from '@/lib/companion-api'
import { LOBBY_VOICE_CAPABLE, LOBBY_VOICE_NOTE } from './lobby-voice'

/** Delay between the greeting text landing and the mic permission request. */
const MIC_REQUEST_DELAY_MS = 300
/** Bubble dwell before it collapses into the dock's one-line summary. */
const BUBBLE_DWELL_MS = 5000

export interface CompanionPresence {
  /** The dock's single visual state (在线/倾听/说话/静音/离线). */
  dockStatus: DockStatus
  /** Persisted posture — drives the mic button's affordance + aria label. */
  posture: VoicePosture
  /** The companion's last utterance this visit (dock text line), or null. */
  lastUtterance: string | null
  /** The floating bubble: visible while a beat dwells or when re-expanded. */
  bubble: { text: string; expanded: boolean } | null
  /** Expand the (clamped) bubble to full content; cancels auto-collapse. */
  expandBubble: () => void
  /** Close the bubble (a tap on an already-expanded bubble dismisses it). */
  dismissBubble: () => void
  /** Re-open the collapsed bubble from the dock text line. */
  reopenBubble: () => void
  /** Mic button action (elevate / retry-permission / downgrade by state). */
  onMicClick: () => void
  /** Control menu — 静音. */
  onMute: () => void
  /** Control menu — 恢复自动语音. */
  onRestoreVoice: () => void
}

function readLocalPlayContext(): {
  lastPlayedAt: number | null
  streakDays: number
  hasPlayedBefore: boolean
} {
  const summary = summarizeArcadeLocalProfile(readArcadeLocalProfile())
  const lastPlayedAt =
    summary.last_activity_at !== null ? Date.parse(summary.last_activity_at) : null
  return {
    lastPlayedAt: Number.isFinite(lastPlayedAt as number) ? lastPlayedAt : null,
    streakDays: summary.daily_loop.streak.current_days,
    hasPlayedBefore: summary.last_activity_at !== null,
  }
}

/**
 * Request mic permission and immediately release the probe stream.
 * `unsupported` (no mediaDevices — insecure context, legacy browser) is NOT a
 * denial: it must never write `denied-remembered`.
 */
async function probeMicPermission(): Promise<'granted' | 'denied' | 'unsupported'> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return 'unsupported'
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach((track) => track.stop())
    return 'granted'
  } catch {
    return 'denied'
  }
}

export function useCompanionPresence(companion: CompanionIdentity): CompanionPresence {
  const location = useLocation()

  // Account posture is the SSOT; adopt it on mount and mirror it to the cache
  // (the cache exists for pre-API reads and stays in sync on every write).
  const [posture, setPosture] = useState<VoicePosture>(companion.voice_posture)
  useEffect(() => {
    if (readCachedVoicePosture() !== companion.voice_posture) {
      writeCachedVoicePosture(companion.voice_posture)
    }
    // Mount-time reconcile only — later writes go through applyPostureEvent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [sessionMuted, setSessionMuted] = useState(false)
  const [sessionElevated, setSessionElevated] = useState(false)
  const [lastUtterance, setLastUtterance] = useState<string | null>(null)
  const [bubble, setBubble] = useState<{ text: string; expanded: boolean } | null>(null)
  /** True while the arrival greeting dwells — the dock reads 说话 (speaking). */
  const [greetingDwell, setGreetingDwell] = useState(false)

  // Mirrored to refs (in an effect, mirroring the useVoiceSession pattern) so
  // timer callbacks and async continuations read current values.
  const postureRef = useRef(posture)
  const sessionMutedRef = useRef(sessionMuted)
  useEffect(() => {
    postureRef.current = posture
    sessionMutedRef.current = sessionMuted
  })

  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const schedule = useCallback((fn: () => void, ms: number) => {
    timersRef.current.push(setTimeout(fn, ms))
  }, [])
  useEffect(
    () => () => {
      timersRef.current.forEach(clearTimeout)
      timersRef.current = []
    },
    []
  )

  /**
   * Persist a posture transition: state + localStorage cache + account.
   * Cheap durability without a retry queue: if the account PUT fails, the
   * cache is rolled back to the previous value so the cache never claims a
   * posture the account did not accept (this visit keeps the new behaviour in
   * session state; the mount-time account-wins reconcile covers the rest).
   */
  const applyPostureEvent = useCallback((event: PostureEvent) => {
    const previous = postureRef.current
    const next = transitionPosture(previous, event)
    if (next !== previous) {
      postureRef.current = next
      setPosture(next)
      writeCachedVoicePosture(next)
      void putVoicePosture(next).then((result) => {
        if (result.kind !== 'ok') writeCachedVoicePosture(previous)
      })
    }
    return next
  }, [])

  // --- Arrival beat + auto-voice sequence (homepage only) ---------------------
  const onHomepage = location.pathname === '/'
  useEffect(() => {
    if (!onHomepage) return
    // 静音回访 (design step 6): quiet/denied postures land muted — no bubble,
    // no permission request; the mic button is the only elevation path.
    if (postureRef.current !== 'voice-default' || sessionMutedRef.current) return

    const today = getTodayString()
    const log = readBeatLog(today)
    const playContext = readLocalPlayContext()
    if (
      !canFireArrivalBeat({
        log,
        now: Date.now(),
        lastPlayedAt: playContext.lastPlayedAt,
        muted: false,
      })
    ) {
      return
    }

    let cancelled = false
    void (async () => {
      // Most recent visible memory (first page, newest first); an error or an
      // empty album degrades to the no-episode greeting variant.
      const memories = await fetchMemories()
      if (cancelled) return
      const recentEpisodeTitle =
        memories.kind === 'ok' && memories.memories.length > 0 ? memories.memories[0].title : null
      const text = buildArrivalGreeting({
        addressStyle: companion.address_style,
        recentEpisodeTitle,
        streakDays: playContext.streakDays,
        hasPlayedBefore: playContext.hasPlayedBefore,
      })

      // Greeting TEXT lands first — never blocked on the permission dialog.
      setBubble({ text, expanded: false })
      setLastUtterance(text)
      setGreetingDwell(true)
      writeBeatLog(recordBeatFired(log, { kind: 'arrival', now: Date.now() }))

      // Auto-voice step 3 (design): 300ms after the text renders, request the
      // mic — ONLY once lobby voice can actually deliver (flag in
      // lobby-voice.ts). While the flag is off, no permission API is ever
      // touched here, so a stub-era denial can never write denied-remembered.
      // When on: grant proceeds to the voice greeting; denial persists
      // denied-remembered and is never auto-repeated.
      if (LOBBY_VOICE_CAPABLE) {
        schedule(() => {
          if (postureRef.current !== 'voice-default') return
          void probeMicPermission().then((outcome) => {
            if (outcome === 'denied') applyPostureEvent('permission-denied')
          })
        }, MIC_REQUEST_DELAY_MS)
      }

      // Bubble dwell → collapse to the dock text line (unless expanded).
      schedule(() => {
        setGreetingDwell(false)
        setBubble((current) => (current && !current.expanded ? null : current))
      }, BUBBLE_DWELL_MS)
    })()
    return () => {
      cancelled = true
    }
    // Fires on homepage entry; the beat log's 5-minute re-open window keeps
    // SPA back-and-forth navigation (and StrictMode's dev double-mount, whose
    // first run is cancelled before it records) from repeating the greeting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onHomepage])

  // --- Controls ---------------------------------------------------------------

  const onMute = useCallback(() => {
    setSessionMuted(true)
    setSessionElevated(false)
    setBubble(null)
    setGreetingDwell(false)
    applyPostureEvent('mute')
  }, [applyPostureEvent])

  const onRestoreVoice = useCallback(() => {
    setSessionMuted(false)
    applyPostureEvent('restore-default')
  }, [applyPostureEvent])

  const onMicClick = useCallback(() => {
    // Lobby voice not shipped yet: the mic button must lead somewhere TRUE.
    // It surfaces the honest note pointing at where voice genuinely runs (the
    // in-game co-play channel) — no permission call, no posture write.
    if (!LOBBY_VOICE_CAPABLE) {
      setBubble({ text: LOBBY_VOICE_NOTE, expanded: true })
      return
    }
    const muted =
      sessionMutedRef.current ||
      ((postureRef.current === 'quiet-remembered' || postureRef.current === 'denied-remembered') &&
        !sessionElevated)
    if (muted) {
      if (postureRef.current === 'denied-remembered') {
        // Manual retry is the ONLY re-request path after a denial; the user
        // gesture lets the browser re-prompt. Grant corrects the old denial
        // back to voice-default; a second denial changes nothing.
        void probeMicPermission().then((outcome) => {
          if (outcome === 'granted') {
            applyPostureEvent('manual-grant')
            setSessionMuted(false)
            setSessionElevated(true)
          }
        })
        return
      }
      // quiet-remembered / session mute: elevate THIS visit only — an explicit
      // mute is undone only by the explicit 恢复自动语音 (least surprise).
      setSessionMuted(false)
      setSessionElevated(true)
      return
    }
    // Voice nominally on → the mic button is the manual downgrade (design:
    // 手动降级语音 → quiet-remembered).
    setSessionMuted(true)
    setSessionElevated(false)
    applyPostureEvent('mute')
  }, [applyPostureEvent, sessionElevated])

  const expandBubble = useCallback(() => {
    setBubble((current) => (current ? { ...current, expanded: true } : current))
  }, [])

  const dismissBubble = useCallback(() => {
    setBubble(null)
    setGreetingDwell(false)
  }, [])

  const reopenBubble = useCallback(() => {
    if (lastUtterance !== null) setBubble({ text: lastUtterance, expanded: true })
  }, [lastUtterance])

  const dockStatus = deriveDockStatus({
    signedInWithCompanion: true,
    posture,
    sessionMuted,
    sessionElevated,
    // No live voice channel exists on platform pages in this slice; the
    // greeting dwell is the one 说话 (speaking) window the dock can honestly
    // show. 倾听 (listening) becomes reachable with the lobby voice session.
    voicePhase: greetingDwell && !sessionMuted ? 'speaking' : 'idle',
  })

  return {
    dockStatus,
    posture,
    lastUtterance,
    bubble,
    expandBubble,
    dismissBubble,
    reopenBubble,
    onMicClick,
    onMute,
    onRestoreVoice,
  }
}
