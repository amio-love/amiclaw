import { describe, expect, it } from 'vitest'
import { sanitizeNickname, validateEvent, validateSubmission } from './validation'
import type { ScoreSubmission } from '../../../shared/leaderboard-types'

// A valid UUID v4 — `validateEvent` checks the canonical 36-char shape.
const VALID_DEVICE_ID = 'aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee'

// Build a structurally-valid event payload for a given name. The timestamp is
// taken as "now" so it always lands inside the today-or-yesterday window the
// validator enforces.
function eventPayload(event: string): Record<string, unknown> {
  return {
    event,
    timestamp: new Date().toISOString(),
    device_id: VALID_DEVICE_ID,
  }
}

describe('validateEvent — event-name whitelist', () => {
  const validNames = [
    'game_start',
    'module_solve',
    'game_complete',
    'game_abandon',
    'manual_load_failed',
    'replay_intent',
    'game_failed_strikeout',
    'game_ended_timeout',
  ]

  for (const name of validNames) {
    it(`accepts the known event name "${name}"`, () => {
      expect(validateEvent(eventPayload(name))).toEqual({ ok: true })
    })
  }

  it('rejects an unknown event name', () => {
    const result = validateEvent(eventPayload('game_failed_meltdown'))
    expect(result.ok).toBe(false)
    expect(result.error).toBe('Unknown event name')
  })
})

// Build a structurally-valid daily submission whose wall-clock `time_ms` is
// offset from the module-time sum by `offsetMs`. Four module times sum to a
// fixed S; `time_ms = S + offsetMs`. A positive offset over-reports (the honest
// direction — transitions); a negative offset under-reports (the cheat
// direction). The date is "today" so it lands inside the today-or-yesterday
// window the validator enforces.
function dailySubmission(offsetMs: number): ScoreSubmission {
  const moduleTimes = [40_000, 35_000, 30_000, 25_000] // sum S = 130_000 ms
  const moduleSum = moduleTimes.reduce((a, b) => a + b, 0)
  return {
    date: new Date().toISOString().slice(0, 10),
    nickname: 'tester',
    time_ms: moduleSum + offsetMs,
    attempt_number: 1,
    module_times: moduleTimes,
    operations_hash: 'mvp-placeholder',
    ai_tool: 'claude',
    device_id: VALID_DEVICE_ID,
  }
}

describe('validateSubmission — module-sum tolerance', () => {
  // Regression for the daily-submit-422 bug: a real daily run's wall-clock
  // `time_ms` exceeds the module-time sum by ~2400ms (three ~800ms inter-module
  // transitions counted in wall-clock but in no module). Under the old fixed
  // 2000ms tolerance this legitimate submission was rejected with
  // "Module times do not match total time"; the scaling tolerance accepts it.
  it('accepts a legitimate daily run with ~2400ms of inter-module transitions', () => {
    expect(validateSubmission(dailySubmission(2_400))).toEqual({ ok: true })
  })

  // Anti-cheat is preserved: an overshoot far beyond the legitimate transition
  // budget (here +30s) is still rejected.
  it('rejects a tampered run whose total far exceeds the legitimate overshoot', () => {
    const result = validateSubmission(dailySubmission(30_000))
    expect(result.ok).toBe(false)
    expect(result.error).toBe('Module times do not match total time')
  })

  // The high-side boundary is strict: an overshoot exactly at the upper bound
  // passes. upperBound = BASE_MARGIN (2000) + PER_TRANSITION_SLACK (800) × 3 = 4400ms.
  it('accepts an overshoot exactly at the high-side boundary', () => {
    expect(validateSubmission(dailySubmission(4_400))).toEqual({ ok: true })
  })

  it('rejects an overshoot one millisecond past the high-side boundary', () => {
    const result = validateSubmission(dailySubmission(4_401))
    expect(result.ok).toBe(false)
    expect(result.error).toBe('Module times do not match total time')
  })

  // Anti-cheat on the LOW side. The leaderboard ranks by ascending time_ms, so a
  // cheater under-reports time_ms relative to their module sum to climb. The
  // low-side window is kept tight at BASE_MARGIN (2000ms) — it is NOT widened by
  // the transition slack, because under-reporting has no legitimate cause. This
  // is the case that the old symmetric `Math.abs(...) > tolerance` check let
  // through once the high-side budget grew to 4400ms.
  it('rejects an under-reported time_ms that the symmetric tolerance would have allowed', () => {
    // -4400 is inside the old symmetric ±4400 band but outside the -2000 low bound.
    const result = validateSubmission(dailySubmission(-4_400))
    expect(result.ok).toBe(false)
    expect(result.error).toBe('Module times do not match total time')
  })

  it('accepts an under-report exactly at the low-side boundary', () => {
    expect(validateSubmission(dailySubmission(-2_000))).toEqual({ ok: true })
  })

  it('rejects an under-report one millisecond past the low-side boundary', () => {
    const result = validateSubmission(dailySubmission(-2_001))
    expect(result.ok).toBe(false)
    expect(result.error).toBe('Module times do not match total time')
  })
})

describe('validateSubmission — plausibility floor (F1 anti-cheat)', () => {
  // Build a submission with an explicit total time and four evenly-split module
  // times that sum to it — so the total floor is the only thing under test.
  function timedSubmission(totalMs: number): ScoreSubmission {
    const per = Math.round(totalMs / 4)
    const moduleTimes = [per, per, per, totalMs - per * 3]
    return {
      date: new Date().toISOString().slice(0, 10),
      nickname: 'tester',
      time_ms: totalMs,
      attempt_number: 1,
      module_times: moduleTimes,
      operations_hash: 'mvp-placeholder',
      ai_tool: 'claude',
      device_id: VALID_DEVICE_ID,
    }
  }

  // The ~36s automated full clear that topped the board over real human runs is
  // now rejected — it sits below the 60s collaborative-loop floor.
  it('rejects a ~36s automated clear that used to reach the board', () => {
    const result = validateSubmission(timedSubmission(36_000))
    expect(result.ok).toBe(false)
    expect(result.error).toBe('Time too short — minimum 60 seconds')
  })

  it('rejects a run one millisecond under the 60s floor', () => {
    expect(validateSubmission(timedSubmission(59_999)).ok).toBe(false)
  })

  it('accepts a run exactly at the 60s floor', () => {
    expect(validateSubmission(timedSubmission(60_000))).toEqual({ ok: true })
  })

  it('accepts a genuine human+AI run well above the floor', () => {
    expect(validateSubmission(timedSubmission(182_000))).toEqual({ ok: true })
  })

  // Per-module structural floor: a padded total (>= 60s) cannot hide a module
  // solved in under 3 seconds.
  it('rejects a plausible total that hides an implausibly fast module', () => {
    const result = validateSubmission({
      ...dailySubmission(0),
      // Sum still 130s (clears the total floor) but one module is 500ms.
      time_ms: 130_000,
      module_times: [500, 55_000, 44_500, 30_000],
    })
    expect(result.ok).toBe(false)
    expect(result.error).toBe('Module solved implausibly fast')
  })

  it('accepts a module exactly at the 3s per-module floor', () => {
    const result = validateSubmission({
      ...dailySubmission(0),
      time_ms: 130_000,
      module_times: [3_000, 52_000, 45_000, 30_000],
    })
    expect(result).toEqual({ ok: true })
  })
})

describe('validateSubmission — leaderboard AI metadata', () => {
  it('requires ai_tool on new score submissions', () => {
    const { ai_tool: _aiTool, ...submission } = dailySubmission(0)
    const result = validateSubmission(submission as ScoreSubmission)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('Invalid ai_tool')
  })

  it('rejects a blank ai_tool after sanitization', () => {
    const result = validateSubmission({ ...dailySubmission(0), ai_tool: '  <b></b>  ' })
    expect(result.ok).toBe(false)
    expect(result.error).toBe('Invalid ai_tool')
  })

  it('accepts an omitted optional ai_model', () => {
    expect(validateSubmission(dailySubmission(0))).toEqual({ ok: true })
  })

  it('accepts a blank optional ai_model so the write path can omit it', () => {
    expect(validateSubmission({ ...dailySubmission(0), ai_model: '  <b></b>  ' })).toEqual({
      ok: true,
    })
  })
})

describe('sanitizeNickname', () => {
  it('preserves Chinese letters while stripping markup and emoji', () => {
    expect(sanitizeNickname('<b>小明_42✨</b>')).toBe('小明_42')
  })

  it('falls back to Anonymous when no display-safe characters remain', () => {
    expect(sanitizeNickname('✨🔥')).toBe('Anonymous')
  })
})
