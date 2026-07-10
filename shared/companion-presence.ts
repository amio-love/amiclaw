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

import {
  milestoneLabel,
  tierUsesAddressPrefix,
  MILESTONE_STREAK_DAYS,
  type FamiliarityTier,
  type MilestoneStreakDay,
} from './companion-familiarity'
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
  beat:
    | { kind: 'arrival'; now: number }
    | { kind: 'milestone'; now: number }
    | { kind: 'post-game'; gameRunId: string }
): CompanionBeatLog {
  // A milestone rides the arrival moment (both land on homepage entry), so it
  // also stamps `lastArrivalAt` — the 5-minute re-open window then suppresses a
  // plain arrival greeting stacking on top within the same visit.
  if (beat.kind === 'arrival' || beat.kind === 'milestone') {
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
  /**
   * Familiarity tier (B9a 称呼): the newcomer tier keeps the fuller address; the
   * warmer tiers drop it for a closer register. Omitted → base tier (fuller
   * address), so a caller that does not pass a tier gets the pre-B9 behaviour.
   */
  tier?: FamiliarityTier
}

/**
 * 节拍 1 template fill (design 文案示例 register: cite one concrete thing from
 * the last episode, then the streak — factual, no profile-layer reference, no
 * kitsch). Every clause is backed by real data; missing data drops the clause
 * instead of inventing one. The familiarity tier modulates the address register
 * (B9a) — a closer relationship drops the explicit name.
 *
 * The welcome-back「回来了」only fires when there is real shared history the
 * companion can point to — an episode to cite, or an ongoing streak (F6). A
 * zero-episode, zero-streak account has no relationship yet, so it gets the
 * neutral first-meeting line instead of a greeting that implies the companion
 * remembers it. (Device-local play is deliberately NOT a trigger: playing solo
 * on this device is not shared companion history.)
 */
export function buildArrivalGreeting(input: ArrivalGreetingInput): string {
  const useAddress = input.tier === undefined || tierUsesAddressPrefix(input.tier)
  const address = useAddress ? input.addressStyle.trim() : ''
  const prefix = address.length > 0 ? `${address}，` : ''
  const streakLine = input.streakDays >= 2 ? `今天第 ${input.streakDays + 1} 天了。` : ''

  if (input.recentEpisodeTitle) {
    return `${prefix}上次${input.recentEpisodeTitle}，我还记着。${streakLine || '今天再来一局？'}`
  }
  if (input.streakDays >= 1) {
    return `${prefix}回来了。${streakLine}今天的题目是新的。`
  }
  return `${prefix}我在这。今天的每日挑战等你。`
}

/**
 * Restrained-strip status line (design §状态机 坞内文字 column): the companion's
 * default「X在这」presence, the live「在听…」cue, and the「X在这（静音中）」muted
 * phrase. The other live phases (说话) surface the utterance itself, not a phrase.
 */
export function statusPhrase(status: DockStatus, name: string): string {
  switch (status) {
    case 'listening':
      return '在听…'
    case 'muted':
      return `${name}在这（静音中）`
    default:
      return `${name}在这`
  }
}

/**
 * Shell-presence memory-hook line (companion-presence §记忆钩子槽): one warm,
 * specific line drawn from the episodic layer, pointing at the most recent
 * shared episode. A new companion with no shared history gets the gentle
 * first-meeting line instead of a fabricated memory. Real data only — the title
 * IS a real episode; missing data falls to the empty state.
 *
 * Restraint is the design's guardrail: this is ONE quiet line the host renders
 * dismissibly, never a stacked notification.
 */
export function buildMemoryHook(recentEpisodeTitle: string | null): string {
  if (recentEpisodeTitle && recentEpisodeTitle.trim().length > 0) {
    return `还记得你上次${recentEpisodeTitle.trim()}。`
  }
  return '我们才刚认识。'
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

// --- Milestone beat (节拍 4 里程碑, B20) -------------------------------------------

/**
 * localStorage key for the once-per-milestone-FOR-LIFE dedup log. Separate from
 * the per-day beat log (which resets each product day): a milestone is a
 * relationship marker, said once and never repeated — even across a streak
 * break and rebuild, "认识一周了" is not a thing to say twice.
 */
export const COMPANION_MILESTONE_LOG_KEY = 'amio_companion_milestone_log'

/** Read the set of milestone thresholds already delivered (defensive parse). */
export function readMilestoneLog(
  storage: ReadableStorage | null = browserLocalStorage()
): MilestoneStreakDay[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(COMPANION_MILESTONE_LOG_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    // Keep only recognized thresholds — tamper / schema-drift resistant.
    return MILESTONE_STREAK_DAYS.filter((day) => parsed.includes(day))
  } catch {
    return []
  }
}

/** Persist the delivered milestone thresholds (normalized + deduped). */
export function writeMilestoneLog(
  fired: readonly MilestoneStreakDay[],
  storage: WritableStorage | null = browserLocalStorage()
): void {
  if (!storage) return
  try {
    const unique = MILESTONE_STREAK_DAYS.filter((day) => fired.includes(day))
    storage.setItem(COMPANION_MILESTONE_LOG_KEY, JSON.stringify(unique))
  } catch {
    // Losing the log means at worst one milestone repeats — never fatal.
  }
}

export interface MilestoneBeatInput {
  log: CompanionBeatLog
  /** Beats are frozen while muted (session or remembered posture). */
  muted: boolean
}

/**
 * Milestone-beat gate (节拍 4): fires deterministically when a milestone is
 * reached — a defining relationship moment is never probabilistically dropped —
 * subject only to the freeze-while-muted rule and the 标准 daily cap. Per the
 * design's 节拍总量 the milestone COUNTS against the cap (the reserved 5th slot),
 * so it does not bypass it. The once-per-milestone dedup is the caller's job via
 * `readMilestoneLog` / `pickMilestone`.
 */
export function canFireMilestoneBeat(input: MilestoneBeatInput): boolean {
  if (input.muted) return false
  if (input.log.count >= STANDARD_PROACTIVITY_TIER.dailyCap) return false
  return true
}

export interface MilestoneGreetingInput {
  /** The milestone reached (its label opens the line). */
  threshold: MilestoneStreakDay
  /** The current streak in days (backs the "no missed day" fact). */
  streakDays: number
  /**
   * An EARLY shared memory's title for the callback clause, or null. Kept real:
   * when absent the line falls back to the honest streak fact instead of
   * inventing an early episode.
   */
  earlyEpisodeTitle: string | null
}

/**
 * 节拍 4 template fill (design 文案示例 register: a time-scale opener + one
 * callback — no badge, no reward, no number worship). The opener is always real
 * (a streak IS consecutive days); the callback cites a real early episode when
 * one is supplied, else falls back to the honest "not one missed day" fact. No
 * address prefix — the design's milestone examples carry the intimacy in the
 * time-scale opener, not the name.
 */
export function buildMilestoneGreeting(input: MilestoneGreetingInput): string {
  const head = `认识${milestoneLabel(input.threshold)}了。`
  const tail = input.earlyEpisodeTitle
    ? `你第一天${input.earlyEpisodeTitle}，我还记得。`
    : `这 ${input.streakDays} 天，你一天没落。`
  return `${head}${tail}`
}
