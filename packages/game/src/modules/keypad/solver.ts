import type { KeypadConfig, KeypadAnswer, SceneInfo } from '@shared/manual-schema'
import type { ManualModules } from '@shared/manual-schema'

/**
 * Finds the one sequence that contains all 4 keypad symbols and returns the
 * click order (positions in config.symbols ordered by their index in that
 * sequence).
 *
 * The manual's sequences are built so any two share at most 3 symbols, hence
 * a 4-symbol subset belongs to at most one sequence. The solver fails loud on
 * any other count: 0 matches = unsolvable, >1 = ambiguous. Both return null
 * rather than silently picking the first match.
 */
export function solveKeypad(
  config: KeypadConfig,
  section: ManualModules['keypad'],
  _sceneInfo: SceneInfo
): KeypadAnswer | null {
  const matches = section.sequences.filter((seq) =>
    config.symbols.every((sym) => seq.includes(sym))
  )
  if (matches.length !== 1) return null

  const seq = matches[0]
  // Order symbols by their position in the matching sequence.
  const sequence = [...config.symbols]
    .sort((a, b) => seq.indexOf(a) - seq.indexOf(b))
    .map((sym) => config.symbols.indexOf(sym))
  return { type: 'keypad', sequence }
}
