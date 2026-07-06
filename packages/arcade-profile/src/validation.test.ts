import { describe, expect, it } from 'vitest'
import {
  defaultArcadePublicLabel,
  parseArcadeProfileClaimBody,
  parseArcadeProfileEvent,
  sanitizeArcadePublicLabel,
} from './validation'

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
      public_label: 'Atlas Player',
    })
    expect(claim?.events[0].profile_id).toBe('profile-claim')
    expect(claim?.public_label).toBe('Atlas Player')
    expect(parseArcadeProfileClaimBody({ profile_id: 'p', user_id: 'u', events: [] })).toBeNull()
  })

  it('sanitizes public labels and falls back without deriving from email text', () => {
    const fallback = defaultArcadePublicLabel('user-a')

    expect(sanitizeArcadePublicLabel('  Atlas   Player  ', 'user-a')).toBe('Atlas Player')
    expect(sanitizeArcadePublicLabel('a@example.com', 'user-a')).toBe(fallback)
    expect(sanitizeArcadePublicLabel('', 'user-a')).toBe(fallback)
    expect(sanitizeArcadePublicLabel('x'.repeat(40), 'user-a')).toBe('x'.repeat(28))
  })
})
