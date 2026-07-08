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
  buildMilestoneGreeting,
  canFireArrivalBeat,
  canFireMilestoneBeat,
  deriveDockStatus,
  readBeatLog,
  readCachedVoicePosture,
  readMilestoneLog,
  recordBeatFired,
  transitionPosture,
  writeBeatLog,
  writeCachedVoicePosture,
  writeMilestoneLog,
  type DockStatus,
  type DockVoicePhase,
  type PostureEvent,
} from '@shared/companion-presence'
import {
  deriveFamiliarityTier,
  pickMilestone,
  MILESTONE_STREAK_DAYS,
} from '@shared/companion-familiarity'
import { getTodayString } from '@shared/date'
import { readArcadeLocalProfile, summarizeArcadeLocalProfile } from '@amiclaw/arcade-profile/local'
import {
  fetchAccountStreak,
  fetchEarliestMemoryTitle,
  fetchMemories,
  putVoicePosture,
} from '@/lib/companion-api'
import { LOBBY_VOICE_CAPABLE, LOBBY_VOICE_NOTE } from './lobby-voice'
import { useLobbyVoiceSession } from './useLobbyVoiceSession'

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

// Device-local play recency for the arrival IDLE gate only (this device's
// session recency — "back after being away"). The STREAK that drives tier +
// milestone is the account value (fetchAccountStreak), never this.
function readLocalPlayContext(): {
  lastPlayedAt: number | null
  hasPlayedBefore: boolean
} {
  const summary = summarizeArcadeLocalProfile(readArcadeLocalProfile())
  const lastPlayedAt =
    summary.last_activity_at !== null ? Date.parse(summary.last_activity_at) : null
  return {
    lastPlayedAt: Number.isFinite(lastPlayedAt as number) ? lastPlayedAt : null,
    hasPlayedBefore: summary.last_activity_at !== null,
  }
}

/**
 * Request mic permission. On grant the probe stream is RETAINED and returned so
 * the lobby voice session can reuse it (the browser is not prompted twice); the
 * caller owns stopping it (handing it to `lobby.open(stream)`, or stopping it if
 * it opens no session). `unsupported` (no mediaDevices — insecure context, legacy
 * browser) is NOT a denial: it must never write `denied-remembered`.
 */
async function probeMicPermission(): Promise<{
  outcome: 'granted' | 'denied' | 'unsupported'
  stream: MediaStream | null
}> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return { outcome: 'unsupported', stream: null }
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    return { outcome: 'granted', stream }
  } catch {
    return { outcome: 'denied', stream: null }
  }
}

export function useCompanionPresence(companion: CompanionIdentity): CompanionPresence {
  const location = useLocation()
  const onHomepage = location.pathname === '/'

  // The manual-less lobby voice session (design step 4). Opened from the grant
  // branch(es) below; its streamed greeting drives the dock subtitle (Option B)
  // and its 3-state phase drives the live dock states. The AUTO-voice arrival
  // sequence still fires on the homepage only, but a MANUAL mic tap can open the
  // session on any signed-in page (the session is page-agnostic); either way it
  // is scene-scoped — teardown on page leave.
  const lobby = useLobbyVoiceSession()
  // Stable action handles (useCallback in the hook) — safe in effect / callback
  // deps without recreating them every render.
  const { open: openLobby, close: closeLobby } = lobby

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
  useEffect(() => {
    if (!onHomepage) return
    // 静音回访 (design step 6): quiet/denied postures land muted — no bubble,
    // no permission request; the mic button is the only elevation path.
    if (postureRef.current !== 'voice-default' || sessionMutedRef.current) return

    const today = getTodayString()
    const log = readBeatLog(today)
    const playContext = readLocalPlayContext()
    const milestoneLog = readMilestoneLog()

    // Sync eligibility gates (no streak needed yet): whether the arrival beat is
    // due (device-local idle gate — this device's session recency), and whether
    // any milestone remains un-fired. If neither could fire, skip the network
    // round-trips entirely — a within-12h return whose milestones are all
    // delivered stays byte-identical (no fetch, no beat).
    const arrivalEligible = canFireArrivalBeat({
      log,
      now: Date.now(),
      lastPlayedAt: playContext.lastPlayedAt,
      muted: false,
    })
    const anyMilestoneUnfired = MILESTONE_STREAK_DAYS.some((day) => !milestoneLog.includes(day))
    if (!arrivalEligible && !anyMilestoneUnfired) return

    let cancelled = false
    void (async () => {
      // The ACCOUNT streak drives the tier + milestone (the relationship lives
      // at the account — familiarity must not jump when the player switches
      // devices). The arrival idle gate above stays device-local. All state is
      // set HERE, inside the async continuation — never synchronously in the
      // effect body (react-hooks/set-state-in-effect).
      const streakDays = await fetchAccountStreak()
      if (cancelled) return
      const tier = deriveFamiliarityTier(streakDays)

      // 节拍 4 里程碑 (B20): a newly reached 7 / 14 / 30 / 60-day streak. Decided
      // from the account streak, independent of the >12h idle threshold (a
      // milestone can land right after the qualifying play). Deduped
      // once-per-milestone FOR LIFE via the persistent milestone log, and it
      // counts against the 标准 daily cap (design reserves the 5th slot). A
      // reached milestone takes this homepage load's beat — the plain arrival
      // greeting is skipped (recordBeatFired stamps lastArrivalAt so the 5-min
      // window suppresses one anyway).
      const milestonePick = anyMilestoneUnfired ? pickMilestone(streakDays, milestoneLog) : null
      const milestone =
        milestonePick !== null && canFireMilestoneBeat({ log, muted: false }) ? milestonePick : null

      // Neither the streak crossed a milestone nor is the arrival beat due.
      if (milestone === null && !arrivalEligible) return

      // --- Milestone beat (takes precedence on a milestone load) ---
      if (milestone !== null) {
        // The earliest shared episode backs the design's 「你第一天…」 callback
        // (real data — null when the album is genuinely empty).
        const earlyEpisodeTitle = await fetchEarliestMemoryTitle()
        if (cancelled) return
        // Persist the consumed thresholds (dedup) then fire, with no await
        // between — the double-crossing lower threshold is retired here too. The
        // `cancelled` guards above fenced a StrictMode double-invoke first.
        writeMilestoneLog([...milestoneLog, ...milestone.consumed])
        const text = buildMilestoneGreeting({
          threshold: milestone.fire,
          streakDays,
          earlyEpisodeTitle,
        })
        setBubble({ text, expanded: false })
        setLastUtterance(text)
        setGreetingDwell(true)
        writeBeatLog(recordBeatFired(log, { kind: 'milestone', now: Date.now() }))
        schedule(() => {
          setGreetingDwell(false)
          setBubble((current) => (current && !current.expanded ? null : current))
        }, BUBBLE_DWELL_MS)
        return
      }

      // --- Arrival greeting (节拍 1) ---
      // Most recent visible memory (first page, newest first); an error or an
      // empty album degrades to the no-episode greeting variant.
      const memories = await fetchMemories()
      if (cancelled) return
      const recentEpisodeTitle =
        memories.kind === 'ok' && memories.memories.length > 0 ? memories.memories[0].title : null
      const text = buildArrivalGreeting({
        addressStyle: companion.address_style,
        recentEpisodeTitle,
        streakDays,
        hasPlayedBefore: playContext.hasPlayedBefore,
        tier,
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
          void probeMicPermission().then(({ outcome, stream }) => {
            // Step 4 — GRANT: open the lobby voice session, reusing the granted
            // stream so the browser is not prompted again. Its streamed greeting
            // then drives the dock subtitle + 说话/倾听 states.
            if (outcome === 'granted') openLobby(stream ?? undefined)
            // Step 5 — DENIAL: persist denied-remembered (never auto-repeated).
            else if (outcome === 'denied') applyPostureEvent('permission-denied')
            // `unsupported` stops any stray track and writes nothing.
            else stream?.getTracks().forEach((t) => t.stop())
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

  // --- Lobby voice channel ↔ dock wiring --------------------------------------

  // Option B: once the voice channel is live, the server's memory-grounded
  // streamed greeting replaces the instant client greeting as the bubble text —
  // the bubble is the live subtitle of what the companion is saying (design §字幕).
  // This is a pure "adjust state from a changing value" (React's documented
  // set-state-during-render pattern, guarded by the last-seen text so it fires
  // once per change), NOT an effect — syncing a streamed value into the bubble in
  // an effect body trips the cascading-render lint and lands one frame late.
  const [lastLobbyText, setLastLobbyText] = useState('')
  if (lobby.live && lobby.aiText.length > 0 && lobby.aiText !== lastLobbyText) {
    setLastLobbyText(lobby.aiText)
    setBubble({ text: lobby.aiText, expanded: false })
    setLastUtterance(lobby.aiText)
  }
  if (!lobby.live && lastLobbyText.length > 0) {
    // Session ended — reset so the NEXT live greeting syncs again.
    setLastLobbyText('')
  }

  // Scene-scoped: leaving the CURRENT page is a scene switch (design §降级触发 —
  // no posture change), so the lobby channel tears down (abrupt close, no
  // memory). Voice can be elevated on ANY signed-in page now (not just the
  // homepage — the lobby session is page-agnostic, resolving companion memory
  // from the auth cookie), so the teardown keys on the pathname CHANGING rather
  // than on being off the homepage: a session opened on /me closes when the
  // player leaves /me. `closeLobby` is idempotent, so firing it on a page with
  // no open session is a harmless no-op.
  const pathname = location.pathname
  const lobbyScenePathRef = useRef(pathname)
  useEffect(() => {
    if (lobbyScenePathRef.current !== pathname) {
      lobbyScenePathRef.current = pathname
      closeLobby('caller')
    }
  }, [pathname, closeLobby])

  // --- Controls ---------------------------------------------------------------

  const onMute = useCallback(() => {
    setSessionMuted(true)
    setSessionElevated(false)
    setBubble(null)
    setGreetingDwell(false)
    // Muting closes the mouth AND any live lobby channel — abrupt close, no
    // memory capture (design §控制面 / §成本姿态).
    closeLobby('caller')
    applyPostureEvent('mute')
  }, [applyPostureEvent, closeLobby])

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
        void probeMicPermission().then(({ outcome, stream }) => {
          if (outcome === 'granted') {
            applyPostureEvent('manual-grant')
            setSessionMuted(false)
            setSessionElevated(true)
            // Elevate into a live channel wherever the player tapped — the lobby
            // session is page-agnostic, so voice genuinely connects on any
            // signed-in page, not just the homepage. It is scene-scoped: leaving
            // this page tears it down (the page-leave teardown effect above).
            openLobby(stream ?? undefined)
          } else {
            stream?.getTracks().forEach((t) => t.stop())
          }
        })
        return
      }
      // quiet-remembered / session mute: elevate THIS visit only — an explicit
      // mute is undone only by the explicit 恢复自动语音 (least surprise). The
      // user gesture opens a live channel on whatever signed-in page they tapped
      // (open() acquires the mic itself — the click is the permission gesture);
      // the session is scene-scoped and tears down on page leave.
      setSessionMuted(false)
      setSessionElevated(true)
      openLobby()
      return
    }
    // Voice nominally on → the mic button is the manual downgrade (design:
    // 手动降级语音 → quiet-remembered): close the live channel and mute.
    setSessionMuted(true)
    setSessionElevated(false)
    closeLobby('caller')
    applyPostureEvent('mute')
  }, [applyPostureEvent, sessionElevated, openLobby, closeLobby])

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

  // Dock voice phase: a LIVE lobby channel drives the honest 3-state (speaking /
  // listening / thinking→idle); before/without one, the instant greeting dwell is
  // the one 说话 window the dock can honestly show.
  const voicePhase: DockVoicePhase = lobby.live
    ? lobby.conversationPhase === 'speaking'
      ? 'speaking'
      : lobby.conversationPhase === 'listening'
        ? 'listening'
        : 'idle' // 'thinking' — the dock has no thinking state; read as 在线
    : greetingDwell && !sessionMuted
      ? 'speaking'
      : 'idle'

  const dockStatus = deriveDockStatus({
    signedInWithCompanion: true,
    posture,
    sessionMuted,
    sessionElevated,
    voicePhase,
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
