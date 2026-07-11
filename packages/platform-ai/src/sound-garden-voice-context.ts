/**
 * Strict public context accepted from the Sound Garden voice client.
 *
 * Mirrors `shadow-chase-voice-context.ts`: the board snapshot the game pushes on
 * every utterance is UNTRUSTED input that ends up injected (data-fenced) into the
 * LLM prompt, so it is bounded here before it is trusted — size cap, exact key
 * set, per-field type + range checks. Rejection returns a reason; it never throws.
 *
 * The exact piece vocabulary (which token is a legal kick/bell/…) is NOT enforced
 * here — that stays with the game's client-side legality guard and engine, which
 * own the board. This layer only bounds SHAPE and SIZE of untrusted input, so it
 * does not couple to the game's piece list; slot occupants are validated as
 * bounded lowercase tokens or `null`.
 */

export const MAX_SOUND_GARDEN_VOICE_CONTEXT_BYTES = 4_096
export const MAX_SOUND_GARDEN_VOICE_SLOTS = 32
export const MAX_SOUND_GARDEN_VOICE_POOL_KEYS = 16
export const MAX_SOUND_GARDEN_VOICE_TOKEN_CODEPOINTS = 32
/** Bound on |score| and |target| so a hostile payload cannot inject a huge number. */
export const MAX_SOUND_GARDEN_VOICE_SCORE_MAGNITUDE = 100_000

type Archetype = 'rhythm_piece' | 'melody_piece'
type Trigger = 'session_start' | 'player_planted' | 'player_spoke' | 'idle'
type Pool = Record<string, number>

export interface SoundGardenVoiceContext {
  slots: number
  /** melody[slotIndex] = the placed melody token, or null. Length === slots. */
  melody: (string | null)[]
  rhythm: (string | null)[]
  score: number
  target: number
  bloomed: boolean
  partnerRemaining: Pool
  playerRemaining: Pool
  partnerArchetype: Archetype
  trigger: Trigger
}

export type SoundGardenVoiceContextValidation =
  | { ok: true; value: SoundGardenVoiceContext }
  | { ok: false; reason: string }

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const sorted = [...expected].sort()
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index])
}

function pieceToken(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    [...value].length > 0 &&
    [...value].length <= MAX_SOUND_GARDEN_VOICE_TOKEN_CODEPOINTS &&
    /^[a-z][a-z0-9-]*$/.test(value)
  )
}

function slotLane(value: unknown, slots: number): value is (string | null)[] {
  return (
    Array.isArray(value) &&
    value.length === slots &&
    value.every((entry) => entry === null || pieceToken(entry))
  )
}

function pool(value: unknown): value is Pool {
  if (!record(value)) return false
  const keys = Object.keys(value)
  if (keys.length > MAX_SOUND_GARDEN_VOICE_POOL_KEYS) return false
  return keys.every(
    (key) =>
      pieceToken(key) &&
      Number.isSafeInteger(value[key]) &&
      (value[key] as number) >= 0 &&
      (value[key] as number) <= MAX_SOUND_GARDEN_VOICE_SLOTS
  )
}

function boundedScore(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    Math.abs(value as number) <= MAX_SOUND_GARDEN_VOICE_SCORE_MAGNITUDE
  )
}

function serializedBytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

export function validateSoundGardenVoiceContext(value: unknown): SoundGardenVoiceContextValidation {
  if (serializedBytes(value) > MAX_SOUND_GARDEN_VOICE_CONTEXT_BYTES) {
    return { ok: false, reason: 'size' }
  }
  if (
    !record(value) ||
    !exactKeys(value, [
      'slots',
      'melody',
      'rhythm',
      'score',
      'target',
      'bloomed',
      'partnerRemaining',
      'playerRemaining',
      'partnerArchetype',
      'trigger',
    ])
  ) {
    return { ok: false, reason: 'keys' }
  }
  const slots = value.slots
  if (
    !Number.isSafeInteger(slots) ||
    (slots as number) < 1 ||
    (slots as number) > MAX_SOUND_GARDEN_VOICE_SLOTS
  ) {
    return { ok: false, reason: 'slots' }
  }
  if (!slotLane(value.melody, slots as number) || !slotLane(value.rhythm, slots as number)) {
    return { ok: false, reason: 'lanes' }
  }
  if (!boundedScore(value.score) || !boundedScore(value.target) || (value.target as number) < 0) {
    return { ok: false, reason: 'score' }
  }
  if (typeof value.bloomed !== 'boolean') {
    return { ok: false, reason: 'bloomed' }
  }
  if (!pool(value.partnerRemaining) || !pool(value.playerRemaining)) {
    return { ok: false, reason: 'pool' }
  }
  if (value.partnerArchetype !== 'rhythm_piece' && value.partnerArchetype !== 'melody_piece') {
    return { ok: false, reason: 'archetype' }
  }
  if (
    value.trigger !== 'session_start' &&
    value.trigger !== 'player_planted' &&
    value.trigger !== 'player_spoke' &&
    value.trigger !== 'idle'
  ) {
    return { ok: false, reason: 'trigger' }
  }
  return { ok: true, value: structuredClone(value) as unknown as SoundGardenVoiceContext }
}
