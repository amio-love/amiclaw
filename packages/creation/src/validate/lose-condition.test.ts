/**
 * lose_condition validator checks (§3) + the v1.0.0→v1.1.0 version lockstep
 * (TC-21). Negatives structuredClone the v1.1.0 golden and mutate one field.
 *
 * Covers test-design cases TC-15, TC-16, TC-21.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadGameType, loadLevel } from '../schema/load'
import type { CheckId, CheckResult, Level, ValidationReport } from '../schema/types'
import { validateLevel } from './validate'

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

function cloneLevel(): Level {
  return structuredClone(level)
}

describe('schema_conformance — lose_condition', () => {
  it('the v1.1.0 golden lose_condition validates clean', () => {
    const check = checkOf(validateLevel(gameType, level), 'schema_conformance')
    expect(check.violations.some((v) => v.constraint.startsWith('lose_condition_'))).toBe(false)
  })

  it('TC-15: lose_condition.type mismatched against the GameType type', () => {
    const bad = cloneLevel()
    bad.lose_condition = { type: 'score_below', params: { target_score: 5 } }
    const check = checkOf(validateLevel(gameType, bad), 'schema_conformance')
    const v = check.violations.find((x) => x.constraint === 'lose_condition_type_match')
    expect(v?.field_path).toBe('lose_condition.type')
    expect(v?.expected).toBe('any_element_state_equals')
  })

  it('TC-16: any_element_state_equals referencing an undeclared state', () => {
    const bad = cloneLevel()
    bad.lose_condition = {
      type: 'any_element_state_equals',
      params: { state: 'vitality', value: 'dead' },
    }
    const check = checkOf(validateLevel(gameType, bad), 'schema_conformance')
    const v = check.violations.find((x) => x.constraint === 'lose_condition_state_declared')
    expect(v?.field_path).toBe('lose_condition.params.state')
    expect(v?.actual).toBe('vitality')
  })

  it('TC-16: any_element_state_equals with a value outside the state enum', () => {
    const bad = cloneLevel()
    bad.lose_condition = {
      type: 'any_element_state_equals',
      params: { state: 'health', value: 'mummified' },
    }
    const check = checkOf(validateLevel(gameType, bad), 'schema_conformance')
    const v = check.violations.find((x) => x.constraint === 'lose_condition_value_in_enum')
    expect(v?.field_path).toBe('lose_condition.params.value')
    expect(v?.expected).toContain('dead')
  })
})

describe('TC-21 — v1.0.0 → v1.1.0 version lockstep', () => {
  it('both golden fixtures are bumped to 1.1.0 together', () => {
    expect(gameType.version).toBe('1.1.0')
    expect(level.metadata.game_type_version).toBe('1.1.0')
  })

  it('a half-bumped level (GameType 1.1.0, level 1.0.0) fails version_binding', () => {
    const bad = cloneLevel()
    bad.metadata.game_type_version = '1.0.0'
    const check = checkOf(validateLevel(gameType, bad), 'schema_conformance')
    const v = check.violations.find((x) => x.constraint === 'version_binding')
    expect(v).toBeTruthy()
    expect(v?.expected).toBe('1.1.0')
  })
})
