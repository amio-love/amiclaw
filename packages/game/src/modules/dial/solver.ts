import type { DialConfig, DialAnswer, SceneInfo } from '@shared/manual-schema'
import type { ManualModules } from '@shared/manual-schema'

/**
 * Finds the one column that contains all 3 current dial symbols,
 * then returns the target position (index in that column) for each dial.
 */
export function solveDial(
  config: DialConfig,
  section: ManualModules['symbol_dial'],
  _sceneInfo: SceneInfo,
): DialAnswer | null {
  const currentSymbols = config.dials.map((dial, i) => dial[config.currentPositions[i]])

  // Find a column that contains all 3 symbols
  for (const col of section.columns) {
    if (currentSymbols.every(sym => col.includes(sym))) {
      // Target position for each dial = index of that symbol in this column
      const positions = currentSymbols.map(sym => col.indexOf(sym))
      return { type: 'dial', positions }
    }
  }
  return null
}
