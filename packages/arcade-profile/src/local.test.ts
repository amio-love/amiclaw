import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ARCADE_LOCAL_PROFILE_KEY,
  getClaimableArcadeProfileEvents,
  markArcadeProfileEventsClaimed,
  readArcadeLocalProfile,
  recordBombSquadLocalRun,
  recordOracleLocalSign,
  summarizeArcadeLocalProfile,
} from './local'

function storage(): Storage {
  const map = new Map<string, string>()
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
    clear: () => map.clear(),
    key: (index) => Array.from(map.keys())[index] ?? null,
    get length() {
      return map.size
    },
  }
}

describe('local arcade profile', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('records BombSquad and Oracle entries into one stable local profile', () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('11111111-1111-4111-8111-111111111111')
    const store = storage()

    const run = recordBombSquadLocalRun(
      {
        runId: 'run-1',
        mode: 'daily',
        outcome: 'defused',
        durationMs: 123_456,
        attemptNumber: 2,
        moduleCount: 4,
        completedModules: 4,
        strikeCount: 1,
        finishedAt: '2026-07-06T08:00:00.000Z',
      },
      store
    )
    const sign = recordOracleLocalSign(
      {
        sessionId: 'oracle-1',
        signDate: '2026-07-06',
        ben: '乾',
        bian: '坤',
        yaoValues: [7, 8, 7, 8, 7, 8],
        createdAt: '2026-07-06T09:00:00.000Z',
      },
      store
    )

    expect(run?.profile_id).toBe('11111111-1111-4111-8111-111111111111')
    expect(sign?.profile_id).toBe('11111111-1111-4111-8111-111111111111')
    const profile = readArcadeLocalProfile(store)
    expect(profile?.profile_id).toBe('11111111-1111-4111-8111-111111111111')
    expect(profile?.bombsquad_runs).toHaveLength(1)
    expect(profile?.oracle_signs).toHaveLength(1)
    expect(store.getItem(ARCADE_LOCAL_PROFILE_KEY)).toContain(
      '11111111-1111-4111-8111-111111111111'
    )

    const summary = summarizeArcadeLocalProfile(profile, '2026-07-06')
    expect(summary.today_played).toBe(true)
    expect(summary.bombsquad.best_daily?.run_id).toBe('run-1')
    expect(summary.oracle.recent?.ben).toBe('乾')
  })

  it('dedupes claimable entries by source key after marking them claimed', () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('22222222-2222-4222-8222-222222222222')
    const store = storage()
    const event = recordBombSquadLocalRun(
      {
        runId: 'run-2',
        mode: 'practice',
        outcome: 'practice-cleared',
        durationMs: 10_000,
        attemptNumber: 1,
        moduleCount: 2,
        completedModules: 2,
        strikeCount: 0,
        finishedAt: '2026-07-06T08:00:00.000Z',
      },
      store
    )
    expect(getClaimableArcadeProfileEvents(readArcadeLocalProfile(store))).toHaveLength(1)

    expect(event?.kind).toBe('bombsquad_run')
    markArcadeProfileEventsClaimed(['bombsquad:run-2'], store)

    expect(getClaimableArcadeProfileEvents(readArcadeLocalProfile(store))).toHaveLength(0)
  })

  it('drops malformed local entries while keeping the profile readable', () => {
    const store = storage()
    store.setItem(
      ARCADE_LOCAL_PROFILE_KEY,
      JSON.stringify({
        version: 1,
        profile_id: 'local-profile',
        created_at: '2026-07-06T08:00:00.000Z',
        updated_at: '2026-07-06T08:00:00.000Z',
        last_seen_at: '2026-07-06T08:00:00.000Z',
        bombsquad_runs: [
          {
            source_key: 'bombsquad:valid-run',
            run_id: 'valid-run',
            mode: 'daily',
            outcome: 'defused',
            duration_ms: 90_000,
            attempt_number: 1,
            module_count: 4,
            completed_modules: 4,
            strike_count: 0,
            finished_at: '2026-07-06T08:00:00.000Z',
          },
          {
            source_key: 'bombsquad:wrong-source',
            run_id: 'different-run',
            mode: 'daily',
            outcome: 'defused',
            duration_ms: 90_000,
            attempt_number: 1,
            module_count: 4,
            completed_modules: 4,
            strike_count: 0,
            finished_at: '2026-07-06T08:00:00.000Z',
          },
        ],
        oracle_signs: [{ source_key: 'oracle:broken' }],
        claimed_source_keys: ['bombsquad:valid-run', 42],
      })
    )

    const profile = readArcadeLocalProfile(store)

    expect(profile?.bombsquad_runs).toHaveLength(1)
    expect(profile?.bombsquad_runs[0]?.run_id).toBe('valid-run')
    expect(profile?.oracle_signs).toHaveLength(0)
    expect(profile?.claimed_source_keys).toEqual(['bombsquad:valid-run'])
    expect(summarizeArcadeLocalProfile(profile, '2026-07-06').today_played).toBe(true)
  })
})
