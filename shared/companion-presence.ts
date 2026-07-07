/**
 * Companion presence layer — pure domain logic for the 伙伴坞 (companion dock).
 *
 * SSOT for the presence-layer rules from companion-presence-design.md:
 *
 *  - voice-posture memory: the localStorage cache + the transition table
 *    (§姿态记忆模型 — mute / downgrade / permission-denied / manual retry /
 *    explicit restore, under the least-surprise principle);
 *  - the dock's 5-state machine (在线 / 倾听 / 说话 / 静音 / 离线);
 *  - proactive-beat gating (§主动性节拍清单): the 标准 tier daily cap, the
 *    arrival beat's >12h-idle trigger and 5-minute re-open suppression, the
 *    once-per-run post-game beat;
 *  - the beat copy builders (arrival greeting, post-game reaction) — template
 *    fill from REAL data only, in the design doc's restrained register.
 *
 * Pure and dependency-light (types from `shared/companion-types` only) so both
 * SPAs (`@amiclaw/platform` dock, `@amiclaw/game-bombsquad` result reaction)
 * consume ONE rule set, unit-testable without a browser. Storage access takes
 * an injectable `Pick<Storage, ...>` like `arcade-profile/local.ts`.
 */

import { isVoicePosture, type VoicePosture } from './companion-types'

// --- Voice-posture cache -------------------------------------------------------

/** localStorage key for the posture cache (design §姿态记忆模型 — exact key). */
export const VOICE_POSTURE_STORAGE_KEY = 'amio_companion_voice_posture'

type ReadableStorage = Pick<Storage, 'getItem'>
type WritableStorage = Pick<Storage, 'setItem'>

function browserLocalStorage(): Storage | null {
  try {
    // Resolve via `window` (not the bare global): Node >= 22 defines its own
    // experimental `localStorage` global that is undefined without a flag and
    // would shadow jsdom's in the test environments.
    if (typeof window === 'undefined') return null
    return window.localStorage ?? null
  } catch {
    // SecurityError in restricted contexts (private mode, sandboxed embeds).
    return null
  }
}

/**
 * Read the cached posture at page load (before the `GET /api/companion` round
 * trip). `null` = no cache — callers fall back to `voice-default` for a fresh
 * companion, per the design's initial posture.
 */
export function readCachedVoicePosture(
  storage: ReadableStorage | null = browserLocalStorage()
): VoicePosture | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(VOICE_POSTURE_STORAGE_KEY)
    return isVoicePosture(raw) ? raw : null
  } catch {
    return null
  }
}

/** Mirror an account-level posture change into the local cache. */
export function writeCachedVoicePosture(
  posture: VoicePosture,
  storage: WritableStorage | null = browserLocalStorage()
): void {
  if (!storage) return
  try {
    storage.setItem(VOICE_POSTURE_STORAGE_KEY, posture)
  } catch {
    // Cache write failure is non-fatal — the account preference is the SSOT.
  }
}

// --- Voice-posture transitions ---------------------------------------------------

/**
 * The player/browser events that can move the persisted posture
 * (design §姿态记忆模型 转换规则). Technical downgrades (blur, disconnect,
 * scene switch) are deliberately NOT events here — they never change the
 * persisted posture.
 */
export type PostureEvent =
  /** Manual mute via the dock long-press menu, or manual voice downgrade. */
  | 'mute'
  /** The browser permission dialog was denied during the auto-voice sequence. */
  | 'permission-denied'
  /** The mic button retry was granted by the browser (user-gesture re-request). */
  | 'manual-grant'
  /** Control menu → 恢复自动语音 (the explicit, symmetric restore). */
  | 'restore-default'

/**
 * Posture transition table. Least-surprise rules encoded:
 *
 *  - a mic-button tap on `quiet-remembered` elevates THE SESSION ONLY and is
 *    not an event here (no persisted change — "接完这个电话不等于取消静音模式");
 *  - `manual-grant` flips `denied-remembered` back to `voice-default` (the
 *    player is correcting an earlier denial) but leaves `quiet-remembered`
 *    alone (an explicit mute needs the explicit restore);
 *  - `permission-denied` from a quiet posture stays quiet-shaped but records
 *    the denial, so no future auto-request can fire.
 */
export function transitionPosture(current: VoicePosture, event: PostureEvent): VoicePosture {
  switch (event) {
    case 'mute':
      // Denial memory outranks mute memory: both suppress auto-voice, but only
      // denied-remembered also blocks the auto permission request forever.
      return current === 'denied-remembered' ? 'denied-remembered' : 'quiet-remembered'
    case 'permission-denied':
      return 'denied-remembered'
    case 'manual-grant':
      return current === 'quiet-remembered' ? 'quiet-remembered' : 'voice-default'
    case 'restore-default':
      return 'voice-default'
  }
}

// --- Dock state machine ----------------------------------------------------------

/** The dock's five states (design §状态机). */
export type DockStatus = 'online' | 'listening' | 'speaking' | 'muted' | 'offline'

/** Live voice-conversation phase, when a voice channel is active. */
export type DockVoicePhase = 'idle' | 'listening' | 'speaking'

export interface DockStatusInput {
  /** A session cookie exists AND the companion is set up. */
  signedInWithCompanion: boolean
  /** Persisted posture (cache-first, account-verified). */
  posture: VoicePosture
  /** The player muted this visit via the dock menu (session flag). */
  sessionMuted: boolean
  /** The player elevated voice this visit via the mic button (session flag). */
  sessionElevated: boolean
  /** Live conversation phase from an active voice session, else 'idle'. */
  voicePhase: DockVoicePhase
}

/**
 * Derive the single dock state (design §状态机). Offline (no dock) for
 * anonymous / companion-less; muted for a remembered-quiet or session-muted
 * visit unless the session was explicitly elevated; the live voice phases win
 * while a channel is active.
 */
export function deriveDockStatus(input: DockStatusInput): DockStatus {
  if (!input.signedInWithCompanion) return 'offline'
  if (input.voicePhase === 'speaking') return 'speaking'
  if (input.voicePhase === 'listening') return 'listening'
  if (input.sessionMuted) return 'muted'
  if (
    (input.posture === 'quiet-remembered' || input.posture === 'denied-remembered') &&
    !input.sessionElevated
  ) {
    return 'muted'
  }
  return 'online'
}

// --- Proactive-beat gating --------------------------------------------------------

/**
 * 标准 tier (the ruled default — design §主动性档位): every beat may fire, at
 * most `dailyCap` companion utterances per product day. `fireProbability` is
 * the tier's per-beat trigger probability knob; the 标准 tier ships at 1 in
 * this slice — the arrival greeting doubles as the auto-voice sequence's
 * first line, which must land deterministically on login — and the quieter
 * probabilistic shaping arrives with the tier-picker slice.
 */
export const STANDARD_PROACTIVITY_TIER = {
  fireProbability: 1,
  dailyCap: 5,
} as const

/** Arrival beat (节拍 1) fires only when the last play is older than this. */
export const ARRIVAL_IDLE_THRESHOLD_MS = 12 * 60 * 60 * 1000
/** Re-opening the homepage within this window never repeats the greeting. */
export const ARRIVAL_REOPEN_SUPPRESS_MS = 5 * 60 * 1000

/** localStorage key for the per-day beat log. */
export const COMPANION_BEAT_LOG_KEY = 'amio_companion_beat_log'

/** Per-product-day record of fired beats (caps + suppression windows). */
export interface CompanionBeatLog {
  /** Product day (`getTodayString()` shape, YYYY-MM-DD). */
  date: string
  /** Companion utterances fired today (all beats). */
  count: number
  /** Epoch ms of the last arrival greeting, for the 5-min re-open window. */
  lastArrivalAt?: number
  /** gameRunId of the last post-game reaction, so one run reacts once. */
  lastPostGameRunId?: string
}

export function emptyBeatLog(date: string): CompanionBeatLog {
  return { date, count: 0 }
}

/** Read today's beat log; a stale (previous-day) or malformed log resets. */
export function readBeatLog(
  today: string,
  storage: ReadableStorage | null = browserLocalStorage()
): CompanionBeatLog {
  if (!storage) return emptyBeatLog(today)
  try {
    const raw = storage.getItem(COMPANION_BEAT_LOG_KEY)
    if (!raw) return emptyBeatLog(today)
    const parsed = JSON.parse(raw) as Partial<CompanionBeatLog>
    if (parsed.date !== today || typeof parsed.count !== 'number' || parsed.count < 0) {
      return emptyBeatLog(today)
    }
    return {
      date: today,
      count: parsed.count,
      ...(typeof parsed.lastArrivalAt === 'number' ? { lastArrivalAt: parsed.lastArrivalAt } : {}),
      ...(typeof parsed.lastPostGameRunId === 'string'
        ? { lastPostGameRunId: parsed.lastPostGameRunId }
        : {}),
    }
  } catch {
    return emptyBeatLog(today)
  }
}

export function writeBeatLog(
  log: CompanionBeatLog,
  storage: WritableStorage | null = browserLocalStorage()
): void {
  if (!storage) return
  try {
    storage.setItem(COMPANION_BEAT_LOG_KEY, JSON.stringify(log))
  } catch {
    // Losing the log means at worst one extra greeting — never fatal.
  }
}

export interface ArrivalBeatInput {
  log: CompanionBeatLog
  /** Now, epoch ms. */
  now: number
  /** Epoch ms of the last recorded play, or null when never played. */
  lastPlayedAt: number | null
  /** Beats are frozen while muted (session or remembered posture). */
  muted: boolean
  /** Injectable RNG for the tier probability (tests pin it). */
  rng?: () => number
}

/**
 * Arrival-greeting gate (节拍 1): companion exists (caller-guaranteed), the
 * player has been away >12h (a never-played account IS an arrival), the
 * greeting was not already shown in the last 5 minutes, the daily cap has
 * room, beats are not frozen, and the tier probability passes.
 */
export function canFireArrivalBeat(input: ArrivalBeatInput): boolean {
  const { log, now, lastPlayedAt, muted, rng = Math.random } = input
  if (muted) return false
  if (log.count >= STANDARD_PROACTIVITY_TIER.dailyCap) return false
  if (log.lastArrivalAt !== undefined && now - log.lastArrivalAt < ARRIVAL_REOPEN_SUPPRESS_MS) {
    return false
  }
  if (lastPlayedAt !== null && now - lastPlayedAt < ARRIVAL_IDLE_THRESHOLD_MS) return false
  return rng() < STANDARD_PROACTIVITY_TIER.fireProbability
}

export interface PostGameBeatInput {
  log: CompanionBeatLog
  /** The settled run's id — one reaction per run, replay-proof. */
  gameRunId: string
  muted: boolean
  rng?: () => number
}

/** Post-game-reaction gate (节拍 3): once per run, within the daily cap. */
export function canFirePostGameBeat(input: PostGameBeatInput): boolean {
  const { log, gameRunId, muted, rng = Math.random } = input
  if (muted) return false
  if (log.count >= STANDARD_PROACTIVITY_TIER.dailyCap) return false
  if (log.lastPostGameRunId === gameRunId) return false
  return rng() < STANDARD_PROACTIVITY_TIER.fireProbability
}

/** Fold a fired beat into the log (caller persists via `writeBeatLog`). */
export function recordBeatFired(
  log: CompanionBeatLog,
  beat: { kind: 'arrival'; now: number } | { kind: 'post-game'; gameRunId: string }
): CompanionBeatLog {
  if (beat.kind === 'arrival') {
    return { ...log, count: log.count + 1, lastArrivalAt: beat.now }
  }
  return { ...log, count: log.count + 1, lastPostGameRunId: beat.gameRunId }
}

// --- Beat copy builders ------------------------------------------------------------

/**
 * Speech-register duration: 「二十三秒」-> "23 秒", 「1 分 07 秒」-> "1 分 7 秒".
 * Plain zh numerals-as-digits keep it honest and TTS-safe.
 */
export function formatDurationSpeech(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes === 0) return `${seconds} 秒`
  if (seconds === 0) return `${minutes} 分钟`
  return `${minutes} 分 ${seconds} 秒`
}

export interface ArrivalGreetingInput {
  /** How the companion addresses the player; empty string = no address. */
  addressStyle: string
  /** Most recent visible memory's title, or null when the album is empty. */
  recentEpisodeTitle: string | null
  /** Current arcade streak in days (0 = no streak). */
  streakDays: number
  /** Whether any local play record exists at all. */
  hasPlayedBefore: boolean
}

/**
 * 节拍 1 template fill (design 文案示例 register: cite one concrete thing from
 * the last episode, then the streak — factual, no profile-layer reference, no
 * kitsch). Every clause is backed by real data; missing data drops the clause
 * instead of inventing one.
 */
export function buildArrivalGreeting(input: ArrivalGreetingInput): string {
  const address = input.addressStyle.trim()
  const prefix = address.length > 0 ? `${address}，` : ''
  const streakLine = input.streakDays >= 2 ? `今天第 ${input.streakDays + 1} 天了。` : ''

  if (input.recentEpisodeTitle) {
    return `${prefix}上次${input.recentEpisodeTitle}，我还记着。${streakLine || '今天再来一局？'}`
  }
  if (input.hasPlayedBefore) {
    return `${prefix}回来了。${streakLine}今天的题目是新的。`
  }
  return `${prefix}我在这。今天的每日挑战等你。`
}

/** The subset of a settled run the post-game reaction may cite. */
export interface PostGameReactionInput {
  outcome: 'defused' | 'exploded' | 'practice-cleared' | 'practice-timeout' | 'daily-timeout'
  durationMs: number | null
  moduleCount: number
  completedModules: number
  strikeCount: number
}

/**
 * 节拍 3 template fill (design register: cite what actually just happened —
 * time, modules; relaxed on a clear; on a failure FACTS ONLY, no consolation
 * — 「失败时不安慰，只说事实」). Only real run facts are cited; no fabricated
 * per-run analysis.
 */
export function buildPostGameReaction(input: PostGameReactionInput): string {
  const duration = input.durationMs !== null ? formatDurationSpeech(input.durationMs) : null
  const stoppedAt = Math.min(input.completedModules + 1, input.moduleCount)

  switch (input.outcome) {
    case 'defused':
    case 'practice-cleared': {
      const head = duration ? `${duration}，` : ''
      return `${head}${input.moduleCount} 个模块全拆完。`
    }
    case 'exploded':
      return `三次失误，停在第 ${stoppedAt} 个模块。`
    case 'practice-timeout':
    case 'daily-timeout':
      return `时间用完，停在第 ${stoppedAt} 个模块。`
  }
}
