// Timing constants shared between the game frontend and the server-side score
// validator. Keeping them here as a single source of truth prevents the two
// sides from drifting: the frontend uses MODULE_ADVANCE_DELAY_MS to pace the
// inter-module transition, and the validator uses the same value to size its
// module-sum tolerance.

/**
 * Delay between solving one module and the next module becoming playable.
 *
 * During this window the run sits in MODULE_COMPLETE before NEXT_MODULE fires.
 * The time is wall-clock — it counts toward `time_ms` (totalEndTime −
 * totalStartTime) but is NOT attributed to any module's `timeMs`. With N
 * modules there are (N − 1) such transitions, so a clean run's wall-clock total
 * exceeds the sum of module times by roughly (N − 1) × MODULE_ADVANCE_DELAY_MS.
 *
 * Consumed by:
 * - packages/game-bombsquad/src/pages/GamePage.tsx (MODULE_COMPLETE → NEXT_MODULE auto-advance)
 * - packages/api/src/validation.ts (module-sum tolerance derivation)
 */
export const MODULE_ADVANCE_DELAY_MS = 800
