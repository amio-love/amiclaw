import { describe, expect, it } from 'vitest'
import { summarizeDailyLoop } from './summary'
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
