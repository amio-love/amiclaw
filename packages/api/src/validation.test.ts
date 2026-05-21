import { describe, expect, it } from 'vitest'
import { validateEvent } from './validation'

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
    'game_failed_timeout',
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
