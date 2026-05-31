import type { DialConfig, DialAnswer, SceneInfo } from '@shared/manual-schema'
import type { ManualModules } from '@shared/manual-schema'

/**
 * Finds the one column that contains all 3 current dial symbols, then returns
 * the target position (index in that column) for each dial.
 *
 * The manual's columns are built so any two share at most 2 symbols, hence a
 * 3-symbol subset belongs to at most one column. The solver fails loud on any
 * other count: 0 matches = unsolvable, >1 = ambiguous. Both return null rather
 * than silently picking the first match.
 */
export function solveDial(
  config: DialConfig,
  section: ManualModules['symbol_dial'],
  _sceneInfo: SceneInfo
): DialAnswer | null {
  const currentSymbols = config.dials.map((dial, i) => dial[config.currentPositions[i]])

  const matches = section.columns.filter((col) => currentSymbols.every((sym) => col.includes(sym)))
  if (matches.length !== 1) return null

  // Target position for each dial = index of that symbol in the matching column.
  const col = matches[0]
  const positions = currentSymbols.map((sym) => col.indexOf(sym))
  return { type: 'dial', positions }
}
