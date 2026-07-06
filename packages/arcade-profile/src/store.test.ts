import { describe, expect, it } from 'vitest'
import {
  readArcadeAccountProfile,
  readArcadeStreakLeaderboard,
  upsertArcadeProfileEvents,
  upsertArcadePublicProfile,
} from './store'
import { createTestDb } from './test-support/sqlite-db'
import type { ArcadeProfileEvent } from './types'

const RUN_EVENT: ArcadeProfileEvent = {
  kind: 'bombsquad_run',
  profile_id: 'profile-1',
  run: {
    source_key: 'bombsquad:run-1',
    run_id: 'run-1',
    mode: 'daily',
    outcome: 'defused',
    duration_ms: 55_000,
    attempt_number: 1,
    module_count: 4,
    completed_modules: 4,
    strike_count: 0,
    finished_at: '2026-07-06T08:00:00.000Z',
  },
}

const SIGN_EVENT: ArcadeProfileEvent = {
  kind: 'oracle_sign',
  profile_id: 'profile-1',
  sign: {
    source_key: 'oracle:2026-07-06:oracle-1',
    session_id: 'oracle-1',
    sign_date: '2026-07-06',
    ben: '乾',
    bian: '坤',
    yao_values: [7, 8, 7, 8, 7, 8],
    created_at: '2026-07-06T09:00:00.000Z',
  },
}

describe('arcade profile store', () => {
  it('upserts source-keyed events idempotently and reads an account summary', async () => {
    const db = createTestDb()
    const deps = { now: () => '2026-07-06T10:00:00.000Z', today: () => '2026-07-06' }

    const first = await upsertArcadeProfileEvents(db, 'user-1', [RUN_EVENT, SIGN_EVENT], { deps })
    const replay = await upsertArcadeProfileEvents(db, 'user-1', [RUN_EVENT], { deps })
    const profile = await readArcadeAccountProfile(db, 'user-1', deps)

    expect(first.inserted).toBe(2)
    expect(replay.inserted).toBe(0)
    expect(profile.today_played).toBe(true)
    expect(profile.daily_loop.streak.current_days).toBe(1)
    expect(profile.counts).toEqual({ bombsquad_runs: 1, oracle_signs: 1 })
    expect(profile.bombsquad.best_daily?.duration_ms).toBe(55_000)
    expect(profile.oracle.recent?.ben).toBe('乾')
  })

  it('uses full account history for streaks beyond the recent 100-row summary', async () => {
    const db = createTestDb()
    const deps = { now: () => '2026-07-06T10:00:00.000Z', today: () => '2026-07-06' }
    const events: ArcadeProfileEvent[] = Array.from({ length: 102 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 2, 27 + index)).toISOString().slice(0, 10)
      const runId = `run-${date}`
      return {
        kind: 'bombsquad_run',
        profile_id: 'profile-long',
        run: {
          source_key: `bombsquad:${runId}`,
          run_id: runId,
          mode: 'daily',
          outcome: 'defused',
          duration_ms: 60_000 + index,
          attempt_number: 1,
          module_count: 4,
          completed_modules: 4,
          strike_count: 0,
          finished_at: `${date}T08:00:00.000Z`,
        },
      }
    })

    await upsertArcadeProfileEvents(db, 'user-long', events, { deps })
    const profile = await readArcadeAccountProfile(db, 'user-long', deps)

    expect(profile.counts.bombsquad_runs).toBe(102)
    expect(profile.daily_loop.streak.current_days).toBe(102)
    expect(profile.daily_loop.streak.longest_days).toBe(102)
  })

  it('derives the public streak board only from claimed public profiles', async () => {
    const db = createTestDb()
    const deps = { now: () => '2026-07-06T10:00:00.000Z', today: () => '2026-07-06' }

    await upsertArcadeProfileEvents(db, 'user-claimed', [RUN_EVENT, SIGN_EVENT], { deps })
    await upsertArcadeProfileEvents(
      db,
      'user-private',
      [
        {
          ...RUN_EVENT,
          run: {
            ...RUN_EVENT.run,
            source_key: 'bombsquad:private-run',
            run_id: 'private-run',
            finished_at: '2026-07-06T07:00:00.000Z',
          },
        },
      ],
      { deps }
    )
    await upsertArcadePublicProfile(db, 'user-claimed', {
      profileId: 'profile-1',
      publicLabel: 'Atlas Player',
      deps,
    })
    await upsertArcadeProfileEvents(
      db,
      'user-stale',
      [
        {
          ...RUN_EVENT,
          run: {
            ...RUN_EVENT.run,
            source_key: 'bombsquad:stale-run',
            run_id: 'stale-run',
            finished_at: '2026-07-03T07:00:00.000Z',
          },
        },
      ],
      { deps }
    )
    await upsertArcadePublicProfile(db, 'user-stale', {
      profileId: 'profile-stale',
      publicLabel: 'Stale Player',
      deps,
    })

    const board = await readArcadeStreakLeaderboard(db, { date: '2026-07-06' })

    expect(board.entries).toEqual([
      {
        rank: 1,
        public_label: 'Atlas Player',
        current_streak_days: 1,
        longest_streak_days: 1,
        last_active_date: '2026-07-06',
        today: { bombsquad_defused: true, oracle_signed: true },
      },
    ])
    expect(JSON.stringify(board)).not.toContain('user-claimed')
    expect(JSON.stringify(board)).not.toContain('profile-1')
    expect(JSON.stringify(board)).not.toContain('Stale Player')
  })
})
