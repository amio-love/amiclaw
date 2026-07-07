import { describe, expect, it } from 'vitest'
import { HISTORY_WINDOW_DAYS, summarizeArcadeProfile, summarizeDailyLoop } from './summary'
import type { BombSquadProfileRun, OracleProfileSign } from './types'

function run(
  runId: string,
  date: string,
  outcome: BombSquadProfileRun['outcome'] = 'defused',
  mode: BombSquadProfileRun['mode'] = 'daily'
): BombSquadProfileRun {
  return {
    source_key: `bombsquad:${runId}`,
    run_id: runId,
    mode,
    outcome,
    duration_ms: 60_000,
    attempt_number: 1,
    module_count: mode === 'daily' ? 4 : 2,
    completed_modules:
      outcome === 'defused' || outcome === 'practice-cleared' ? (mode === 'daily' ? 4 : 2) : 1,
    strike_count: outcome === 'exploded' ? 3 : 0,
    finished_at: `${date}T08:00:00.000Z`,
  }
}

function sign(sessionId: string, date: string): OracleProfileSign {
  return {
    source_key: `oracle:${date}:${sessionId}`,
    session_id: sessionId,
    sign_date: date,
    ben: '乾',
    bian: '坤',
    yao_values: [7, 8, 7, 8, 7, 8],
    created_at: `${date}T09:00:00.000Z`,
  }
}

function staleSign(sessionId: string, signDate: string, createdDate: string): OracleProfileSign {
  return {
    ...sign(sessionId, signDate),
    source_key: `oracle:${signDate}:${sessionId}`,
    created_at: `${createdDate}T09:00:00.000Z`,
  }
}

describe('daily loop summary', () => {
  it('counts only qualified daily activities and dedupes same-day completions', () => {
    const summary = summarizeDailyLoop({
      today: '2026-07-06',
      bombsquadRuns: [
        run('daily-1', '2026-07-06'),
        run('daily-2', '2026-07-06'),
        run('practice-1', '2026-07-05', 'practice-cleared', 'practice'),
        run('failed-1', '2026-07-05', 'exploded'),
      ],
      oracleSigns: [sign('oracle-1', '2026-07-05')],
    })

    expect(summary.checklist.bombsquad_daily.completed).toBe(true)
    expect(summary.checklist.oracle_sign.completed).toBe(false)
    expect(summary.streak.today_completed).toBe(true)
    expect(summary.streak.current_days).toBe(2)
    expect(summary.streak.longest_days).toBe(2)
  })

  it('carries yesterday streak through today and resets after a gap', () => {
    const active = summarizeDailyLoop({
      today: '2026-07-06',
      bombsquadRuns: [run('daily-1', '2026-07-04'), run('daily-2', '2026-07-05')],
      oracleSigns: [],
    })
    const broken = summarizeDailyLoop({
      today: '2026-07-06',
      bombsquadRuns: [run('daily-1', '2026-07-03'), run('daily-2', '2026-07-04')],
      oracleSigns: [],
    })

    expect(active.streak.current_days).toBe(2)
    expect(active.streak.today_completed).toBe(false)
    expect(broken.streak.current_days).toBe(0)
    expect(broken.streak.longest_days).toBe(2)
  })

  it('does not count reopened Oracle signs as fresh streak activity', () => {
    const summary = summarizeDailyLoop({
      today: '2026-07-06',
      bombsquadRuns: [],
      oracleSigns: [staleSign('oracle-1', '2026-07-06', '2026-07-05')],
    })

    expect(summary.checklist.oracle_sign.completed).toBe(false)
    expect(summary.streak.today_completed).toBe(false)
    expect(summary.streak.current_days).toBe(0)
  })
})

describe('recent history — the /me 7-day record view', () => {
  it('covers the last 7 product days, today first, across a month boundary', () => {
    const summary = summarizeArcadeProfile({
      today: '2026-07-03',
      bombsquadRuns: [],
      oracleSigns: [],
    })

    expect(summary.history).toHaveLength(HISTORY_WINDOW_DAYS)
    expect(summary.history.map((day) => day.date)).toEqual([
      '2026-07-03',
      '2026-07-02',
      '2026-07-01',
      '2026-06-30',
      '2026-06-29',
      '2026-06-28',
      '2026-06-27',
    ])
  })

  it("surfaces yesterday's records — check-ins, best daily time, and the sign", () => {
    const fastRun = { ...run('daily-fast', '2026-07-05'), duration_ms: 45_000 }
    const summary = summarizeArcadeProfile({
      today: '2026-07-06',
      bombsquadRuns: [
        run('daily-slow', '2026-07-05'),
        fastRun,
        run('failed', '2026-07-05', 'exploded'),
      ],
      oracleSigns: [sign('oracle-1', '2026-07-05')],
    })

    const yesterday = summary.history[1]
    expect(yesterday.date).toBe('2026-07-05')
    expect(yesterday.bombsquad_daily_completed).toBe(true)
    expect(yesterday.oracle_signed).toBe(true)
    expect(yesterday.runs).toBe(3)
    expect(yesterday.best_daily?.run_id).toBe('daily-fast')
    expect(yesterday.sign?.ben).toBe('乾')

    const today = summary.history[0]
    expect(today.bombsquad_daily_completed).toBe(false)
    expect(today.runs).toBe(0)
    expect(today.best_daily).toBeNull()
    expect(today.sign).toBeNull()
  })

  it('keys signs on sign_date but qualifies check-ins on same-day creation', () => {
    // A sign for 07-05 that was actually created on 07-06 still DISPLAYS under
    // 07-05 (that is the day it is for), but does not count as a 07-05 打卡.
    const summary = summarizeArcadeProfile({
      today: '2026-07-06',
      bombsquadRuns: [],
      oracleSigns: [staleSign('oracle-1', '2026-07-05', '2026-07-06')],
    })

    const day = summary.history[1]
    expect(day.date).toBe('2026-07-05')
    expect(day.sign?.session_id).toBe('oracle-1')
    expect(day.oracle_signed).toBe(false)
  })

  it('counts practice-only days as runs without a daily check-in', () => {
    const summary = summarizeArcadeProfile({
      today: '2026-07-06',
      bombsquadRuns: [run('p1', '2026-07-04', 'practice-cleared', 'practice')],
      oracleSigns: [],
    })

    const day = summary.history[2]
    expect(day.date).toBe('2026-07-04')
    expect(day.runs).toBe(1)
    expect(day.bombsquad_daily_completed).toBe(false)
    expect(day.best_daily).toBeNull()
  })
})
