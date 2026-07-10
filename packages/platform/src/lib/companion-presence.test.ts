/**
 * shared/companion-presence — the presence layer's pure rule set.
 *
 * Covers the three rule families the dock and the result-page reaction both
 * depend on: the posture transition table (incl. the denied path), the dock
 * 5-state machine, and the proactive-beat gating (arrival idle threshold,
 * 5-minute re-open suppression, daily cap, per-run post-game dedupe), plus the
 * template-fill copy builders.
 */
import { describe, expect, it } from 'vitest'
import {
  ARRIVAL_IDLE_THRESHOLD_MS,
  ARRIVAL_REOPEN_SUPPRESS_MS,
  COMPANION_MILESTONE_LOG_KEY,
  STANDARD_PROACTIVITY_TIER,
  VOICE_POSTURE_STORAGE_KEY,
  buildArrivalGreeting,
  buildMemoryHook,
  buildMilestoneGreeting,
  buildPostGameReaction,
  canFireArrivalBeat,
  canFireMilestoneBeat,
  canFirePostGameBeat,
  deriveDockStatus,
  emptyBeatLog,
  formatDurationSpeech,
  readBeatLog,
  readCachedVoicePosture,
  readMilestoneLog,
  recordBeatFired,
  transitionPosture,
  writeBeatLog,
  writeCachedVoicePosture,
  writeMilestoneLog,
} from '@shared/companion-presence'

const NOW = Date.parse('2026-07-08T12:00:00.000Z')
const TODAY = '2026-07-08'

function storageStub(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    map,
  }
}

describe('voice-posture cache', () => {
  it('round-trips a posture and rejects junk', () => {
    const storage = storageStub()
    expect(readCachedVoicePosture(storage)).toBeNull()
    writeCachedVoicePosture('quiet-remembered', storage)
    expect(storage.map.get(VOICE_POSTURE_STORAGE_KEY)).toBe('quiet-remembered')
    expect(readCachedVoicePosture(storage)).toBe('quiet-remembered')
    storage.map.set(VOICE_POSTURE_STORAGE_KEY, 'shouting')
    expect(readCachedVoicePosture(storage)).toBeNull()
  })
})

describe('transitionPosture', () => {
  it('mute / manual downgrade remembers quiet', () => {
    expect(transitionPosture('voice-default', 'mute')).toBe('quiet-remembered')
    expect(transitionPosture('quiet-remembered', 'mute')).toBe('quiet-remembered')
  })

  it('a browser denial remembers denied and outranks mute memory', () => {
    expect(transitionPosture('voice-default', 'permission-denied')).toBe('denied-remembered')
    expect(transitionPosture('quiet-remembered', 'permission-denied')).toBe('denied-remembered')
    // Muting while denied keeps the denial memory (both suppress auto-voice,
    // only denied also blocks the auto permission request).
    expect(transitionPosture('denied-remembered', 'mute')).toBe('denied-remembered')
  })

  it('a granted manual retry corrects a denial back to voice-default', () => {
    expect(transitionPosture('denied-remembered', 'manual-grant')).toBe('voice-default')
    // …but never un-mutes an explicit quiet choice (least surprise: a mic tap
    // elevates the session only; the persisted mute needs the explicit restore).
    expect(transitionPosture('quiet-remembered', 'manual-grant')).toBe('quiet-remembered')
  })

  it('the explicit restore always returns to voice-default', () => {
    expect(transitionPosture('quiet-remembered', 'restore-default')).toBe('voice-default')
    expect(transitionPosture('denied-remembered', 'restore-default')).toBe('voice-default')
  })
})

describe('deriveDockStatus', () => {
  const base = {
    signedInWithCompanion: true,
    posture: 'voice-default' as const,
    sessionMuted: false,
    sessionElevated: false,
    voicePhase: 'idle' as const,
  }

  it('is offline without a signed-in companion', () => {
    expect(deriveDockStatus({ ...base, signedInWithCompanion: false })).toBe('offline')
  })

  it('lands muted for quiet-remembered AND denied-remembered visits', () => {
    expect(deriveDockStatus({ ...base, posture: 'quiet-remembered' })).toBe('muted')
    // The denied-remembered landing is the design's 静音回访 entry path too.
    expect(deriveDockStatus({ ...base, posture: 'denied-remembered' })).toBe('muted')
  })

  it('a session elevation lifts a remembered-quiet visit to online', () => {
    expect(deriveDockStatus({ ...base, posture: 'quiet-remembered', sessionElevated: true })).toBe(
      'online'
    )
  })

  it('session mute wins over voice-default; live phases win over everything', () => {
    expect(deriveDockStatus({ ...base, sessionMuted: true })).toBe('muted')
    expect(deriveDockStatus({ ...base, voicePhase: 'speaking' })).toBe('speaking')
    expect(deriveDockStatus({ ...base, voicePhase: 'listening' })).toBe('listening')
    expect(deriveDockStatus(base)).toBe('online')
  })
})

describe('arrival beat gating (节拍 1)', () => {
  const eligible = {
    log: emptyBeatLog(TODAY),
    now: NOW,
    lastPlayedAt: NOW - ARRIVAL_IDLE_THRESHOLD_MS - 1,
    muted: false,
    rng: () => 0,
  }

  it('fires after >12h idle, and for a never-played account', () => {
    expect(canFireArrivalBeat(eligible)).toBe(true)
    expect(canFireArrivalBeat({ ...eligible, lastPlayedAt: null })).toBe(true)
  })

  it('stays quiet within the 12h play window', () => {
    expect(canFireArrivalBeat({ ...eligible, lastPlayedAt: NOW - 60_000 })).toBe(false)
  })

  it('never repeats within the 5-minute re-open window', () => {
    const fired = recordBeatFired(emptyBeatLog(TODAY), { kind: 'arrival', now: NOW })
    expect(
      canFireArrivalBeat({ ...eligible, log: fired, now: NOW + ARRIVAL_REOPEN_SUPPRESS_MS - 1 })
    ).toBe(false)
    expect(
      canFireArrivalBeat({ ...eligible, log: fired, now: NOW + ARRIVAL_REOPEN_SUPPRESS_MS + 1 })
    ).toBe(true)
  })

  it('respects the daily cap and the mute freeze', () => {
    const capped = { ...emptyBeatLog(TODAY), count: STANDARD_PROACTIVITY_TIER.dailyCap }
    expect(canFireArrivalBeat({ ...eligible, log: capped })).toBe(false)
    expect(canFireArrivalBeat({ ...eligible, muted: true })).toBe(false)
  })
})

describe('post-game beat gating (节拍 3)', () => {
  it('fires once per run within the cap, frozen while muted', () => {
    const log = emptyBeatLog(TODAY)
    expect(canFirePostGameBeat({ log, gameRunId: 'run-1', muted: false, rng: () => 0 })).toBe(true)

    const fired = recordBeatFired(log, { kind: 'post-game', gameRunId: 'run-1' })
    expect(canFirePostGameBeat({ log: fired, gameRunId: 'run-1', muted: false })).toBe(false)
    expect(
      canFirePostGameBeat({ log: fired, gameRunId: 'run-2', muted: false, rng: () => 0 })
    ).toBe(true)

    const capped = { ...log, count: STANDARD_PROACTIVITY_TIER.dailyCap }
    expect(canFirePostGameBeat({ log: capped, gameRunId: 'run-3', muted: false })).toBe(false)
    expect(canFirePostGameBeat({ log, gameRunId: 'run-1', muted: true })).toBe(false)
  })
})

describe('beat log persistence', () => {
  it('round-trips today and resets a stale or malformed log', () => {
    const storage = storageStub()
    const fired = recordBeatFired(emptyBeatLog(TODAY), { kind: 'arrival', now: NOW })
    writeBeatLog(fired, storage)
    expect(readBeatLog(TODAY, storage)).toEqual(fired)
    // Next product day: the log resets (caps are per-day).
    expect(readBeatLog('2026-07-09', storage)).toEqual(emptyBeatLog('2026-07-09'))
    storage.map.set('amio_companion_beat_log', 'not-json')
    expect(readBeatLog(TODAY, storage)).toEqual(emptyBeatLog(TODAY))
  })
})

describe('copy builders', () => {
  it('formats speech-register durations', () => {
    expect(formatDurationSpeech(23_000)).toBe('23 秒')
    expect(formatDurationSpeech(60_000)).toBe('1 分钟')
    expect(formatDurationSpeech(67_400)).toBe('1 分 7 秒')
  })

  it('builds the arrival greeting from real data, no-history first-meeting for an empty relationship (F6)', () => {
    // A cited episode → the memory line.
    expect(
      buildArrivalGreeting({
        addressStyle: '队长',
        recentEpisodeTitle: '最后三秒拆掉了炸弹',
        streakDays: 3,
      })
    ).toBe('队长，上次最后三秒拆掉了炸弹，我还记着。今天第 4 天了。')

    // No episode but a real ongoing streak → the welcome-back line.
    expect(
      buildArrivalGreeting({
        addressStyle: '',
        recentEpisodeTitle: null,
        streakDays: 1,
      })
    ).toBe('回来了。今天的题目是新的。')

    // No episode AND no streak (a zero-history account) → the first-meeting
    // line, never a 「回来了」that implies the companion remembers it.
    expect(
      buildArrivalGreeting({
        addressStyle: '',
        recentEpisodeTitle: null,
        streakDays: 0,
      })
    ).toBe('我在这。今天的每日挑战等你。')
  })

  it('builds the shell memory-hook line from a real episode, gentle empty state otherwise', () => {
    expect(buildMemoryHook('卡在光弦')).toBe('还记得你上次卡在光弦。')
    expect(buildMemoryHook('  最后三秒拆掉了炸弹  ')).toBe('还记得你上次最后三秒拆掉了炸弹。')
    // A new companion with no shared history → the first-meeting register.
    expect(buildMemoryHook(null)).toBe('我们才刚认识。')
    expect(buildMemoryHook('   ')).toBe('我们才刚认识。')
  })

  it('builds the post-game reaction from run facts, factual on failure', () => {
    expect(
      buildPostGameReaction({
        outcome: 'defused',
        durationMs: 143_000,
        moduleCount: 4,
        completedModules: 4,
        strikeCount: 1,
      })
    ).toBe('2 分 23 秒，4 个模块全拆完。')

    expect(
      buildPostGameReaction({
        outcome: 'exploded',
        durationMs: 200_000,
        moduleCount: 4,
        completedModules: 2,
        strikeCount: 3,
      })
    ).toBe('三次失误，停在第 3 个模块。')

    expect(
      buildPostGameReaction({
        outcome: 'daily-timeout',
        durationMs: null,
        moduleCount: 4,
        completedModules: 3,
        strikeCount: 0,
      })
    ).toBe('时间用完，停在第 4 个模块。')
  })

  it('modulates the arrival address by familiarity tier (B9a)', () => {
    const base = {
      addressStyle: '队长',
      recentEpisodeTitle: '最后三秒拆掉了炸弹',
      streakDays: 8,
    }
    // Newcomer (default / explicit) keeps the fuller address.
    expect(buildArrivalGreeting(base)).toBe(
      '队长，上次最后三秒拆掉了炸弹，我还记着。今天第 9 天了。'
    )
    expect(buildArrivalGreeting({ ...base, tier: 'newcomer' })).toBe(
      '队长，上次最后三秒拆掉了炸弹，我还记着。今天第 9 天了。'
    )
    // Familiar / close drop the explicit name for a closer register.
    expect(buildArrivalGreeting({ ...base, tier: 'familiar' })).toBe(
      '上次最后三秒拆掉了炸弹，我还记着。今天第 9 天了。'
    )
    expect(buildArrivalGreeting({ ...base, tier: 'close' })).toBe(
      '上次最后三秒拆掉了炸弹，我还记着。今天第 9 天了。'
    )
  })
})

describe('milestone beat (B20)', () => {
  it('round-trips the milestone log and rejects junk / non-thresholds', () => {
    const storage = storageStub()
    expect(readMilestoneLog(storage)).toEqual([])
    writeMilestoneLog([7, 14], storage)
    expect(readMilestoneLog(storage)).toEqual([7, 14])
    // Only recognized thresholds survive a defensive re-read.
    storage.map.set(COMPANION_MILESTONE_LOG_KEY, JSON.stringify([7, 999, 'oops']))
    expect(readMilestoneLog(storage)).toEqual([7])
    storage.map.set(COMPANION_MILESTONE_LOG_KEY, 'not json')
    expect(readMilestoneLog(storage)).toEqual([])
  })

  it('gates on the daily cap and the mute freeze, deterministically otherwise', () => {
    expect(canFireMilestoneBeat({ log: emptyBeatLog(TODAY), muted: false })).toBe(true)
    expect(canFireMilestoneBeat({ log: emptyBeatLog(TODAY), muted: true })).toBe(false)
    const capped = { date: TODAY, count: STANDARD_PROACTIVITY_TIER.dailyCap }
    expect(canFireMilestoneBeat({ log: capped, muted: false })).toBe(false)
  })

  it('records a milestone against the cap and stamps the arrival window', () => {
    const next = recordBeatFired(emptyBeatLog(TODAY), { kind: 'milestone', now: NOW })
    expect(next.count).toBe(1)
    // Stamping lastArrivalAt suppresses a plain arrival stacking in the same visit.
    expect(next.lastArrivalAt).toBe(NOW)
  })

  it('builds the milestone line: time scale + honest fact, or an early callback', () => {
    expect(buildMilestoneGreeting({ threshold: 7, streakDays: 7, earlyEpisodeTitle: null })).toBe(
      '认识一周了。这 7 天，你一天没落。'
    )
    expect(buildMilestoneGreeting({ threshold: 30, streakDays: 31, earlyEpisodeTitle: null })).toBe(
      '认识一个月了。这 31 天，你一天没落。'
    )
    expect(
      buildMilestoneGreeting({
        threshold: 7,
        streakDays: 7,
        earlyEpisodeTitle: '连题目都没看完就开剪',
      })
    ).toBe('认识一周了。你第一天连题目都没看完就开剪，我还记得。')
  })
})
