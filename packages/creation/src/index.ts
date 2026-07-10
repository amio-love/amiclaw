/*
 * @amiclaw/creation — public API barrel for engine reuse by consuming apps
 * (e.g. @amiclaw/game-botanical). Additive only; the dev/ harness and every
 * internal module are untouched. Re-exports the schema types + loader, the
 * runtime engine, the bounded solver, and the validator entry points.
 */

// Schema meta-model (types + the runtime co-play-form catalog constants).
export * from './schema/types'

// YAML loader.
export { loadGameType, loadLevel, SchemaLoadError } from './schema/load'

// Runtime engine session.
export { GameSession } from './engine/engine'
export type {
  EngineSnapshot,
  RoleView,
  RoleElementView,
  ActionResult,
  PerformActionArgs,
  TimedTick,
  TimerStatus,
} from './engine/engine'

// Bounded solution search (solver).
export { searchSolution, solutionDriversForTarget } from './engine/search'
export type { SolutionSearchResult, SolutionDrivers } from './engine/search'

// Validator entry points.
export { validateLevel, validateGameType } from './validate/validate'
