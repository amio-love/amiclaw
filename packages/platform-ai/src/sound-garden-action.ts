/**
 * Strict parse-guard for the Sound Garden co_build action channel.
 *
 * The partner (an LLM) emits its board moves as a JSON array inside a fenced
 * action block; the bounded splitter (`cobuild-splitter.ts`) extracts the raw
 * body and hands it here. This guard mirrors the probe's wire contract
 * (`game-sound-garden` `normalizePartnerReply` / `parsePartnerReply`) and Shadow
 * Chase's reject-on-invalid stance (`shadow-chase-intent.ts`
 * `parseShadowChaseIntentResponse`): any violation — non-array body, unknown verb,
 * a piece type outside the fixed Sound Garden vocabulary, non-integer / non-positive
 * slot, or more than one move — drops the WHOLE action set (the partner still
 * speaks) and never throws.
 *
 * Board-state legality (piece belongs to THIS partner's lane, slot in range,
 * material still available) is NOT checked here — that stays client-side in the
 * game's own `filterLegalActions` guard, which owns the live board. This layer
 * bounds the SHAPE and the element VOCABULARY (op must be a known verb, pieceType
 * a known element) before the action reaches the client.
 */

import type { CoBuildAction } from './contract'

/**
 * The co_build verb vocabulary. Single source shared by the parse guard (the
 * accepted `op` set) and the per-game prompt instruction (`buildCoBuildInstruction`
 * lists these to the model). Aligned to the future MCP tool surface.
 */
export const CO_BUILD_VERBS = ['place', 'remove'] as const

const VERB_SET = new Set<string>(CO_BUILD_VERBS)

/**
 * The authoritative Sound Garden element vocabulary — the 8 fixed piece types
 * (4 rhythm + 4 melody). This mirrors `entity_types` in the game-type source of
 * truth (`packages/creation/fixtures/sound-garden/game-type.yaml`) and the probe's
 * `RHYTHM_TYPES` / `MELODY_TYPES`. It lives here (not imported from `@amiclaw/creation`)
 * to avoid a runtime YAML-loading dependency in the voice pipeline; if it ever
 * drifts, the game-type YAML is the SSOT. The parse-guard rejects any pieceType
 * outside this set, so a forged or hallucinated element never reaches the client.
 */
export const SOUND_GARDEN_PIECE_TYPES = [
  'kick',
  'snare',
  'hihat',
  'clap',
  'bell',
  'chime',
  'flute',
  'harp',
] as const

const PIECE_TYPE_SET = new Set<string>(SOUND_GARDEN_PIECE_TYPES)

type SoundGardenPieceType = (typeof SOUND_GARDEN_PIECE_TYPES)[number]

/**
 * Display-label → enum-id aliases, mirroring the `display_labels` map in the
 * game-type SSOT (`packages/creation/fixtures/sound-garden/game-type.yaml`). The
 * real partner (DeepSeek) speaks Chinese, so it emits the piece's Chinese name
 * (e.g. 军鼓) in the fence rather than the `snare` id; this maps those back to the
 * canonical id. It stays VOCABULARY-BOUNDED — a token outside both the id set and
 * this alias map still rejects, so a hallucinated element cannot slip through.
 */
const PIECE_ALIASES = new Map<string, SoundGardenPieceType>([
  ['底鼓', 'kick'],
  ['军鼓', 'snare'],
  ['踩镲', 'hihat'],
  ['拍掌', 'clap'],
  ['铃铛', 'bell'],
  ['风铃', 'chime'],
  ['笛音', 'flute'],
  ['竖琴', 'harp'],
])

/**
 * Resolve a raw piece token to a canonical id, or null if outside the vocabulary.
 * Uses a `Map` (not a plain-object lookup) so a token like `__proto__` cannot
 * resolve to a prototype value and slip past the vocabulary guard.
 */
function resolvePieceType(raw: string): SoundGardenPieceType | null {
  if (PIECE_TYPE_SET.has(raw)) return raw as SoundGardenPieceType
  return PIECE_ALIASES.get(raw) ?? null
}

/**
 * Parse and validate the raw fence body into a list of co_build actions.
 *
 * Tolerates an optional ```json code fence around the array (the model
 * occasionally wraps it), then requires a JSON array containing zero or one
 * well-shaped action. Returns `null` on ANY violation so the caller drops the
 * entire set; returns `[]` for a validly-empty array (no move this turn). Never
 * throws.
 *
 * Accepts either the wire `piece_type` (snake_case, matching the probe's
 * DeepSeek contract) or `pieceType`, normalizing both to `pieceType`.
 */
export function parseCoBuildActions(raw: string): CoBuildAction[] | null {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim()
  if (stripped === '') return []
  let parsed: unknown
  try {
    parsed = JSON.parse(stripped)
  } catch {
    return null
  }
  if (!Array.isArray(parsed)) return null
  if (parsed.length > 1) return null
  const actions: CoBuildAction[] = []
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) return null
    const record = entry as Record<string, unknown>
    const op = record.op
    const rawPiece = record.piece_type ?? record.pieceType
    const slot = record.slot
    if (typeof op !== 'string' || !VERB_SET.has(op)) return null
    if (typeof rawPiece !== 'string') return null
    // Accept the enum id OR a vocabulary display label (军鼓 → snare); anything
    // else is out-of-vocabulary and drops the whole set.
    const pieceType = resolvePieceType(rawPiece)
    if (pieceType === null) return null
    if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 1) return null
    actions.push({ op: op as 'place' | 'remove', pieceType, slot })
  }
  return actions
}
