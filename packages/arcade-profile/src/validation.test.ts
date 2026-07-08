import { describe, expect, it } from 'vitest'
import {
  accountDerivedPublicLabel,
  defaultArcadePublicLabel,
  isGeneratedArcadePublicLabel,
  parseArcadeProfileClaimBody,
  parseArcadeProfileEvent,
  resolveArcadePublicLabel,
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

describe('arcade public label precedence (F-C)', () => {
  it('detects the generated Player <hex> placeholder', () => {
    expect(isGeneratedArcadePublicLabel('Player 53CD')).toBe(true)
    expect(isGeneratedArcadePublicLabel(defaultArcadePublicLabel('user-x'))).toBe(true)
    expect(isGeneratedArcadePublicLabel('小明')).toBe(false)
    expect(isGeneratedArcadePublicLabel('Player One')).toBe(false)
    expect(isGeneratedArcadePublicLabel('byheaven0912')).toBe(false)
  })

  it('derives the account default from the email local-part', () => {
    expect(accountDerivedPublicLabel('byheaven0912@gmail.com', 'user-a')).toBe('byheaven0912')
    // No usable local-part → the anonymous placeholder, not an empty label.
    expect(accountDerivedPublicLabel('@gmail.com', 'user-a')).toBe(
      defaultArcadePublicLabel('user-a')
    )
  })

  it('resolves by precedence: chosen nickname > existing real name > email > placeholder', () => {
    const base = { email: 'byheaven0912@gmail.com', userId: 'user-a' }

    // 1. Client-provided nickname wins.
    expect(
      resolveArcadePublicLabel({ ...base, clientLabel: '海阔天空', existingLabel: 'Player 53CD' })
    ).toBe('海阔天空')

    // 2. An existing REAL name is preserved when no client label is sent.
    expect(resolveArcadePublicLabel({ ...base, existingLabel: '海阔天空' })).toBe('海阔天空')

    // 3. No client label + no real existing label → account email local-part
    //    (never the generated placeholder for a logged-in user).
    expect(resolveArcadePublicLabel({ ...base, existingLabel: null })).toBe('byheaven0912')

    // 4. An existing PLACEHOLDER is upgraded to the account default on re-claim.
    expect(resolveArcadePublicLabel({ ...base, existingLabel: 'Player 53CD' })).toBe('byheaven0912')

    // A client label that sanitizes to the placeholder (email / illegal chars)
    // never overwrites with Player XXXX — it falls through to the account email.
    expect(resolveArcadePublicLabel({ ...base, clientLabel: 'a@b.com', existingLabel: null })).toBe(
      'byheaven0912'
    )
  })
})
