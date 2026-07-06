/**
 * Level validation entry (spec Mechanism 3 validator contract).
 *
 * Runs the four universal checks and enumerates the GameType's co-play-form
 * floor checks from the catalog registry — never a hardcoded form→checks
 * mapping. Enumerated floor ids execute through the implemented-checks
 * registry (both the hidden_info_coop pair and the co_build pair are
 * implemented); ids for later forms without an implementation are emitted
 * with verdict 'skipped': explicitly present in the report, never silently
 * absent, never a fake pass. Any skipped check caps overall_verdict at
 * 'warn' (never 'pass'), and publish_ready is true only when every check —
 * universal and activated floor alike — is a literal 'pass'.
 *
 * The validator is strictly read-only over both inputs (spec invariant:
 * validators never modify the Level).
 */

import type {
  CheckResult,
  CoPlayFormCatalog,
  GameType,
  Level,
  ValidationReport,
  Verdict,
} from '../schema/types'
import { SEED_CO_PLAY_FORM_CATALOG } from '../schema/types'
import { checkBudgetCompliance } from './budget-compliance'
import { checkCommunicationCompleteness } from './communication-completeness'
import { checkConstructionVisibility } from './construction-visibility'
import { checkFairness } from './fairness'
import { checkGoalReachability } from './goal-reachability'
import { checkProgressMeasurability } from './progress-measurability'
import { checkSchemaConformance } from './schema-conformance'
import { checkSolvability } from './solvability'
import { checkVerbalDistinguishability } from './verbal-distinguishability'

export { validateGameType } from './gametype-consistency'

/**
 * Implemented floor checks (hidden_info_coop pair + co_build trio). The
 * CoPlayFormCatalog stays the single enumeration source — this registry
 * only decides whether an enumerated id executes or surfaces as 'skipped'.
 */
const IMPLEMENTED_FLOOR_CHECKS: Record<string, (gameType: GameType, level: Level) => CheckResult> =
  {
    communication_completeness: checkCommunicationCompleteness,
    verbal_distinguishability: checkVerbalDistinguishability,
    goal_reachability: checkGoalReachability,
    progress_measurability: checkProgressMeasurability,
    construction_visibility: checkConstructionVisibility,
  }

export function validateLevel(
  gameType: GameType,
  level: Level,
  catalog: CoPlayFormCatalog = SEED_CO_PLAY_FORM_CATALOG
): ValidationReport {
  const checks: CheckResult[] = [
    checkSchemaConformance(gameType, level, catalog),
    checkSolvability(gameType, level),
    checkFairness(gameType, level),
    checkBudgetCompliance(gameType, level),
  ]

  const form = catalog.find((entry) => entry.id === gameType.co_play_form)
  for (const floorCheckId of form?.floor_checks ?? []) {
    const implementation = IMPLEMENTED_FLOOR_CHECKS[floorCheckId]
    checks.push(
      implementation
        ? implementation(gameType, level)
        : { check_type: floorCheckId, verdict: 'skipped', violations: [] }
    )
  }

  return {
    level_id: level.metadata.id,
    game_type: level.metadata.game_type,
    game_type_version: level.metadata.game_type_version,
    overall_verdict: aggregateVerdict(checks),
    publish_ready: checks.every((check) => check.verdict === 'pass'),
    checks,
  }
}

/**
 * A skipped check is "not evaluated", never "pass": it caps the overall
 * verdict at 'warn' so a spec-literal pass gate can never ship a level
 * whose activated floor checks did not run.
 */
function aggregateVerdict(checks: CheckResult[]): Verdict {
  const evaluated = checks.filter((check) => check.verdict !== 'skipped')
  if (evaluated.some((check) => check.verdict === 'fail')) return 'fail'
  const anySkipped = evaluated.length !== checks.length
  if (anySkipped || evaluated.some((check) => check.verdict === 'warn')) return 'warn'
  return 'pass'
}
