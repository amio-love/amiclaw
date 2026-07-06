import { describe, expect, it } from 'vitest'
import { readArcadeAccountProfile, upsertArcadeProfileEvents } from './store'
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
    expect(profile.counts).toEqual({ bombsquad_runs: 1, oracle_signs: 1 })
    expect(profile.bombsquad.best_daily?.duration_ms).toBe(55_000)
    expect(profile.oracle.recent?.ben).toBe('乾')
  })
})
