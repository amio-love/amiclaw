/**
 * Bounded incremental speech/action splitter for the co_build channel.
 *
 * A co_build-capable partner emits its spoken reply followed by a trailing fenced
 * action block, e.g.
 *
 *   你好，我先放一个底鼓打底。<<<ACTIONS>>>[{"op":"place","piece_type":"kick","slot":1}]<<<END_ACTIONS>>>
 *
 * The server must stream the SPEECH to TTS immediately (no whole-reply buffering)
 * while never letting a fence marker or action-block byte reach TTS, and never
 * swallowing a genuine speech prefix. A naive `buffer + delta` scan cannot do all
 * three, so this runs a 3-state machine with a bounded carry buffer:
 *
 *   SPEECH → ACTIONS → DISCARD (terminal once entered)
 *
 * - SPEECH holds back only the longest suffix of the stream that could still grow
 *   into `OPEN` (≤ `CARRY_MAX` chars); everything definitely-not-a-prefix streams
 *   out at once. If the fence never materializes, `flush` releases the held carry
 *   verbatim, so no speech is ever lost.
 * - On `OPEN` the marker bytes are consumed (never emitted) and everything after
 *   it accumulates in the action buffer, which never touches TTS.
 * - The action buffer is capped at `ACTION_MAX_BYTES` UTF-8 bytes; exceeding it
 *   enters the terminal DISCARD state, which clears the buffer and swallows every
 *   remaining delta this turn — the already-streamed pre-fence speech is kept, but
 *   no action chunk is produced and no marker/JSON byte can leak.
 *
 * The splitter is per-turn: construct a fresh one for each reply.
 */

import type { CoBuildAction } from './contract'

/** Fence markers. Mirror them verbatim in the prompt instruction (see below). */
export const CO_BUILD_OPEN = '<<<ACTIONS>>>'
export const CO_BUILD_CLOSE = '<<<END_ACTIONS>>>'

/** Most chars that could be a partial `OPEN` prefix, held back in SPEECH state. */
const CARRY_MAX = CO_BUILD_OPEN.length - 1

/**
 * UTF-8 BYTE cap on the captured action text (cf. Shadow Chase's
 * `MAX_MODEL_OUTPUT_BYTES`). Bounds a hostile / runaway action block.
 */
export const ACTION_MAX_BYTES = 2048

type SplitterState = 'speech' | 'actions' | 'discard'

const encoder = new TextEncoder()

/** Length of the longest suffix of `s` that is a prefix of `OPEN` (0..CARRY_MAX). */
function longestOpenPrefixSuffix(s: string): number {
  const max = Math.min(s.length, CARRY_MAX)
  for (let k = max; k > 0; k -= 1) {
    if (s.endsWith(CO_BUILD_OPEN.slice(0, k))) return k
  }
  return 0
}

/** The trailing speech + parsed actions produced when the LLM stream ends. */
export interface CoBuildFlushResult {
  /** Trailing speech to emit (the held carry in SPEECH state; '' otherwise). */
  speech: string
  /** Parsed actions, or `[]` on discard / parse-reject / no fence. */
  actions: CoBuildAction[]
}

export class CoBuildSplitter {
  private state: SplitterState = 'speech'
  private carry = ''
  private actionBuf = ''
  private ended = false

  /** `parse` is the game's strict co_build parse-guard (rejects the whole set → null). */
  constructor(private readonly parse: (raw: string) => CoBuildAction[] | null) {}

  /**
   * Feed one LLM text delta. Returns the SPEECH portion to emit now (never a fence
   * marker, never action-block content). A partial `OPEN` prefix (≤ `CARRY_MAX`
   * chars) is withheld until the next delta or `flush`.
   */
  push(delta: string): string {
    if (this.state === 'discard') return ''
    if (this.state === 'actions') {
      this.actionBuf += delta
      this.guardOverflow()
      return ''
    }
    // SPEECH
    this.carry += delta
    const openAt = this.carry.indexOf(CO_BUILD_OPEN)
    if (openAt !== -1) {
      const speech = this.carry.slice(0, openAt)
      this.actionBuf = this.carry.slice(openAt + CO_BUILD_OPEN.length)
      this.state = 'actions'
      this.carry = ''
      this.guardOverflow()
      return speech
    }
    const keep = longestOpenPrefixSuffix(this.carry)
    const cut = this.carry.length - keep
    const speech = this.carry.slice(0, cut)
    this.carry = this.carry.slice(cut)
    return speech
  }

  private guardOverflow(): void {
    if (encoder.encode(this.actionBuf).byteLength > ACTION_MAX_BYTES) {
      this.actionBuf = ''
      this.state = 'discard'
    }
  }

  /**
   * Flush at LLM stream end. In SPEECH state the held carry IS real speech (no
   * fence ever came) — return it. In DISCARD state return nothing. In ACTIONS
   * state strip a trailing `CLOSE` if present and parse the body (parse-reject
   * → `[]`). Idempotent.
   */
  flush(): CoBuildFlushResult {
    if (this.ended) return { speech: '', actions: [] }
    this.ended = true
    if (this.state === 'speech') {
      const speech = this.carry
      this.carry = ''
      return { speech, actions: [] }
    }
    if (this.state === 'discard') {
      return { speech: '', actions: [] }
    }
    const body = this.actionBuf.split(CO_BUILD_CLOSE)[0]
    return { speech: '', actions: this.parse(body) ?? [] }
  }
}

/**
 * Build the per-game co_build prompt instruction. Appended to the system message
 * ONLY when a game has a co_build capability, so every other game's prompt is
 * byte-identical. Uses the exact `OPEN` / `CLOSE` markers the splitter parses, so
 * the model and the parser can never drift.
 */
export function buildCoBuildInstruction(coBuild: { verbs: readonly string[] }): string {
  return [
    'Co-build channel: besides speaking, you may place or remove pieces on the shared board.',
    'To do so, append EXACTLY ONE fenced action block at the very END of your reply, after all',
    'your spoken words. The block is a JSON array of moves. Format:',
    `${CO_BUILD_OPEN}[{"op":"place","piece_type":"kick","slot":1}]${CO_BUILD_CLOSE}`,
    `- "op" is one of: ${coBuild.verbs.join(', ')}.`,
    '- "piece_type" is the piece to place or remove; "slot" is a 1-based integer.',
    '- The fenced block is parsed as structured moves and is NEVER read aloud: keep every',
    '  human-facing word in your speech, and put ONLY the JSON array inside the fence.',
    '- Omit the fence entirely on a turn where you make no move. Never emit more than one fence.',
  ].join('\n')
}
