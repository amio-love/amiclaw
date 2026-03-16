import type { KeypadConfig, KeypadAnswer, SceneInfo } from '@shared/manual-schema'
import type { ManualModules } from '@shared/manual-schema'

/**
 * Finds the one sequence that contains all 4 keypad symbols.
 * Returns click order: positions in config.symbols in the order they appear in that sequence.
 */
export function solveKeypad(
  config: KeypadConfig,
  section: ManualModules['keypad'],
  _sceneInfo: SceneInfo,
): KeypadAnswer | null {
  for (const seq of section.sequences) {
    if (config.symbols.every(sym => seq.includes(sym))) {
      // Order symbols by their position in the sequence
      const sequence = [...config.symbols]
        .sort((a, b) => seq.indexOf(a) - seq.indexOf(b))
        .map(sym => config.symbols.indexOf(sym))
      return { type: 'keypad', sequence }
    }
  }
  return null
}
