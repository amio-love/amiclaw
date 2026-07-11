/**
 * bg-standard-001 validation gate (mirrors the bg-demo-001 golden gate): the
 * bigger 5-plant standard level must reach overall pass + publish_ready with
 * the solver finding a care path within budget, and the synergy DATA edit must
 * leave bg-demo-001 still passing.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { searchSolution } from '../engine/search'
import { loadGameType, loadLevel } from '../schema/load'
import { validateLevel } from './validate'

const bgDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'fixtures',
  'botanical-garden'
)
const gameType = loadGameType(readFileSync(join(bgDir, 'game-type.yaml'), 'utf8'))
const standard = loadLevel(readFileSync(join(bgDir, 'level.bg-standard-001.yaml'), 'utf8'))
const tutorial = loadLevel(readFileSync(join(bgDir, 'level.bg-demo-001.yaml'), 'utf8'))

describe('bg-standard-001 golden gate', () => {
  const report = validateLevel(gameType, standard)

  it('reaches overall pass + publish_ready with every activated check passing', () => {
    for (const check of report.checks) {
      expect(`${String(check.check_type)}:${check.verdict}`).toBe(
        `${String(check.check_type)}:pass`
      )
    }
    expect(report.overall_verdict).toBe('pass')
    expect(report.publish_ready).toBe(true)
  })

  it('activates the hidden_info_coop floors (same six checks as the tutorial)', () => {
    expect(report.checks).toHaveLength(6)
    const checkTypes = report.checks.map((c) => c.check_type)
    expect(checkTypes).toContain('communication_completeness')
    expect(checkTypes).toContain('verbal_distinguishability')
  })

  it('the solver finds a care path, and shade is load-bearing for the orchid', () => {
    const result = searchSolution(gameType, standard)
    expect(result.solvable).toBe(true)
    expect(result.timedOut).toBe(false)
    expect(result.path.length).toBeGreaterThan(0)
    // The orchid heals ONLY via rule-light → rule-orchid-care (no correct_care
    // row on rule-health-orchid), so the solution must shade it.
    expect(result.path).toContain('rule-light')
    expect(result.path).toContain('rule-orchid-care')
  })
})

describe('bg-demo-001 is unaffected by the synergy effect_schema edit', () => {
  it('still validates overall pass + publish_ready', () => {
    const report = validateLevel(gameType, tutorial)
    expect(report.overall_verdict).toBe('pass')
    expect(report.publish_ready).toBe(true)
  })
})
