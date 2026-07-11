/**
 * Two structural-integrity guards closed in the R2 fix round:
 * - F2/TC-06: duplicate values in a state enum (state_values_unique) — the
 *   indexOf-rank hazard the test-design contract required an explicit decision on.
 * - F3: a lose-condition terminal state must have no outgoing state_transition
 *   row (terminal_state_no_exit) — the validator mirror of the engine's
 *   "dead is terminal" guard, closing the transition-path resurrection gap.
 *
 * Negatives structuredClone the v1.1.0 golden and mutate one field.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadGameType, loadLevel } from '../schema/load'
import type { CheckId, CheckResult, GameType, Level, ValidationReport } from '../schema/types'
import { validateGameType, validateLevel } from './validate'

const bgDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'fixtures',
  'botanical-garden'
)
const gameType = loadGameType(readFileSync(join(bgDir, 'game-type.yaml'), 'utf8'))
const level = loadLevel(readFileSync(join(bgDir, 'level.bg-demo-001.yaml'), 'utf8'))

function checkOf(report: ValidationReport, checkType: CheckId): CheckResult {
  const check = report.checks.find((c) => c.check_type === checkType)
  if (!check) throw new Error(`check ${checkType} missing from report`)
  return check
}

function cloneGameType(): GameType {
  return structuredClone(gameType)
}

function cloneLevel(): Level {
  return structuredClone(level)
}

describe('F2 / TC-06 — state_values_unique', () => {
  it('flags a duplicate value in a state enum', () => {
    const gt = cloneGameType()
    const plant = gt.element_archetypes.find((a) => a.id === 'plant')
    const health = plant?.states?.find((s) => s.name === 'health')
    if (!health) throw new Error('fixture health state missing')
    health.values = ['dead', 'dead', 'critical', 'wilting', 'stable', 'thriving']
    const v = validateGameType(gt).violations.find((x) => x.constraint === 'state_values_unique')
    expect(v).toBeTruthy()
    expect(v?.field_path).toBe('game_type.element_archetypes[0].states[0].values[1]')
    expect(v?.actual).toContain('dead')
    expect(v?.suggestion).toBeTruthy()
  })

  it('the golden GameType has no duplicate state values', () => {
    expect(
      validateGameType(gameType).violations.some((v) => v.constraint === 'state_values_unique')
    ).toBe(false)
  })
})

describe('F3 — terminal_state_no_exit', () => {
  it('flags a transition OUT of the lose terminal (dead-exit revival row)', () => {
    const bad = cloneLevel()
    const ruleHealth = bad.rules.find((r) => r.id === 'rule-health')
    if (!ruleHealth) throw new Error('fixture rule-health missing')
    const rows = ruleHealth.bindings.transitions as unknown[]
    ruleHealth.bindings = {
      ...ruleHealth.bindings,
      transitions: [...rows, ['dead', 'correct_care', 'wilting']],
    }
    const check = checkOf(validateLevel(gameType, bad), 'schema_conformance')
    const v = check.violations.find((x) => x.constraint === 'terminal_state_no_exit')
    expect(v).toBeTruthy()
    expect(v?.actual).toContain('dead')
    expect(check.verdict).toBe('fail')
  })

  it('a transition INTO the terminal (neglect → dead) is fine; the golden passes', () => {
    // The golden's [critical, neglect, dead] row transitions INTO dead, not out.
    const check = checkOf(validateLevel(gameType, level), 'schema_conformance')
    expect(check.violations.some((v) => v.constraint === 'terminal_state_no_exit')).toBe(false)
  })
})
