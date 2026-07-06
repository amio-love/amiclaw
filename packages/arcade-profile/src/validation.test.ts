import { describe, expect, it } from 'vitest'
import { parseArcadeProfileClaimBody, parseArcadeProfileEvent } from './validation'

const RUN_EVENT = {
  kind: 'bombsquad_run',
  profile_id: 'profile-1',
  run: {
    source_key: 'bombsquad:run-1',
    run_id: 'run-1',
    mode: 'daily',
    outcome: 'defused',
    duration_ms: 1234,
    attempt_number: 1,
    module_count: 4,
    completed_modules: 4,
    strike_count: 0,
    finished_at: '2026-07-06T08:00:00.000Z',
  },
}

describe('arcade profile validation', () => {
  it('accepts a bounded source-keyed event', () => {
    expect(parseArcadeProfileEvent(RUN_EVENT)).toMatchObject({
      kind: 'bombsquad_run',
      run: { run_id: 'run-1' },
    })
  })

  it('rejects owner ids and source-key mismatches', () => {
    expect(parseArcadeProfileEvent({ ...RUN_EVENT, user_id: 'attacker' })).toBeNull()
    expect(
      parseArcadeProfileEvent({
        ...RUN_EVENT,
        run: { ...RUN_EVENT.run, source_key: 'bombsquad:other-run' },
      })
    ).toBeNull()
  })

  it('applies the claim profile id without accepting an owner id', () => {
    const claim = parseArcadeProfileClaimBody({
      profile_id: 'profile-claim',
      events: [{ ...RUN_EVENT, profile_id: undefined }],
    })
    expect(claim?.events[0].profile_id).toBe('profile-claim')
    expect(parseArcadeProfileClaimBody({ profile_id: 'p', user_id: 'u', events: [] })).toBeNull()
  })
})
