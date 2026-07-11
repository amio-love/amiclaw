/**
 * timed_emitters + initial_timers validator checks (§2). Registration-time
 * referential integrity lives in validateGameType (the 7 emitter checks);
 * Level-side overrides + the decay-coverage reachability invariant live in
 * schema_conformance. All negatives structuredClone the golden and mutate one
 * field, mirroring the established cloneGameType()/cloneLevel() pattern.
 *
 * Covers test-design cases TC-05, TC-07..TC-14, the R1 form of TC-17
 * (emitter_target_reaches_terminal), and TC-33 part 1 (fields genuinely
 * optional — siblings carry neither).
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadGameType, loadLevel } from '../schema/load'
import type {
  CheckId,
  CheckResult,
  GameType,
  Level,
  TimedEmitter,
  ValidationReport,
} from '../schema/types'
import { validateGameType, validateLevel } from './validate'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures')
const bgDir = join(fixturesDir, 'botanical-garden')
const gameType = loadGameType(readFileSync(join(bgDir, 'game-type.yaml'), 'utf8'))
const level = loadLevel(readFileSync(join(bgDir, 'level.bg-demo-001.yaml'), 'utf8'))
const rcGameType = loadGameType(
  readFileSync(join(fixturesDir, 'radio-cipher', 'game-type.yaml'), 'utf8')
)
const sgGameType = loadGameType(
  readFileSync(join(fixturesDir, 'sound-garden', 'game-type.yaml'), 'utf8')
)

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

/** A registration-valid decay emitter; `mut` mutates the single bad field. */
function withEmitter(mut?: (emitter: TimedEmitter) => void): GameType {
  const emitter: TimedEmitter = {
    id: 'decay',
    event: 'neglect',
    target_template: 'health_response',
    target: { kind: 'all' },
    interval_ms: 60_000,
    warning_lead_ms: 8000,
  }
  if (mut) mut(emitter)
  const gt = cloneGameType()
  gt.timed_emitters = [emitter]
  return gt
}

describe('validateGameType — timed_emitter referential integrity', () => {
  it('a well-formed emitter adds no emitter_* violations (positive baseline)', () => {
    const violations = validateGameType(withEmitter()).violations
    expect(violations.some((v) => v.constraint.startsWith('emitter_'))).toBe(false)
  })

  it('TC-07: target_template unregistered → emitter_template_registered', () => {
    const v = validateGameType(
      withEmitter((e) => {
        e.target_template = 'no_such_template'
      })
    ).violations.find((x) => x.constraint === 'emitter_template_registered')
    expect(v?.field_path).toBe('game_type.timed_emitters[0].target_template')
    expect(v?.suggestion).toBeTruthy()
  })

  it('TC-08: target_template resolves but is not a state_transition → emitter_template_kind', () => {
    for (const badTemplate of ['compatibility_matrix', 'needs_rule']) {
      const v = validateGameType(
        withEmitter((e) => {
          e.target_template = badTemplate
        })
      ).violations.find((x) => x.constraint === 'emitter_template_kind')
      expect(v, badTemplate).toBeTruthy()
      expect(v?.field_path).toBe('game_type.timed_emitters[0].target_template')
    }
  })

  it('TC-09: event not in the target template events → emitter_event_in_table', () => {
    const v = validateGameType(
      withEmitter((e) => {
        e.event = 'photosynthesize'
      })
    ).violations.find((x) => x.constraint === 'emitter_event_in_table')
    expect(v?.field_path).toBe('game_type.timed_emitters[0].event')
    expect(v?.expected).toContain('neglect')
  })

  it('TC-10: non-positive / NaN interval_ms → emitter_interval_positive', () => {
    for (const bad of [0, -5, Number.NaN]) {
      const v = validateGameType(
        withEmitter((e) => {
          e.interval_ms = bad
        })
      ).violations.find((x) => x.constraint === 'emitter_interval_positive')
      expect(v, `interval ${bad}`).toBeTruthy()
      expect(v?.field_path).toBe('game_type.timed_emitters[0].interval_ms')
    }
  })

  it('TC-05 / TC-11: warning_lead_ms half-open bound [0, interval)', () => {
    const bounds = (lead: number) =>
      validateGameType(
        withEmitter((e) => {
          e.interval_ms = 1000
          e.warning_lead_ms = lead
        })
      ).violations.some((x) => x.constraint === 'emitter_warning_lead_bounds')
    // Passing boundaries.
    expect(bounds(0)).toBe(false)
    expect(bounds(999)).toBe(false)
    // Failing: lead >= interval.
    expect(bounds(1000)).toBe(true)
    expect(bounds(5000)).toBe(true)
    const v = validateGameType(
      withEmitter((e) => {
        e.interval_ms = 1000
        e.warning_lead_ms = 1000
      })
    ).violations.find((x) => x.constraint === 'emitter_warning_lead_bounds')
    expect(v?.field_path).toBe('game_type.timed_emitters[0].warning_lead_ms')
  })

  it('TC-12: duplicate emitter id → emitter_id_unique on the second entry', () => {
    const gt = cloneGameType()
    gt.timed_emitters = [
      {
        id: 'decay',
        event: 'neglect',
        target_template: 'health_response',
        target: { kind: 'all' },
        interval_ms: 1000,
      },
      {
        id: 'decay',
        event: 'neglect',
        target_template: 'health_response',
        target: { kind: 'all' },
        interval_ms: 2000,
      },
    ]
    const v = validateGameType(gt).violations.find((x) => x.constraint === 'emitter_id_unique')
    expect(v?.field_path).toBe('game_type.timed_emitters[1].id')
  })

  it('TC-13: archetype target unresolved → emitter_target_archetype', () => {
    const v = validateGameType(
      withEmitter((e) => {
        e.target = { kind: 'archetype', archetype: 'shrub' }
      })
    ).violations.find((x) => x.constraint === 'emitter_target_archetype')
    expect(v?.field_path).toBe('game_type.timed_emitters[0].target.archetype')
  })
})

describe('schema_conformance — initial_timers overrides (TC-14)', () => {
  function conformanceFor(timers: Record<string, unknown>): CheckResult {
    const gt = withEmitter() // declares the "decay" emitter
    const lvl = cloneLevel()
    const plant = lvl.elements.find((e) => e.id === 'plant-1')
    if (!plant) throw new Error('fixture element missing')
    plant.initial_timers = timers as Level['elements'][number]['initial_timers']
    return checkOf(validateLevel(gt, lvl), 'schema_conformance')
  }

  it('flags a non-positive interval_ms override → timer_override_bounds', () => {
    const check = conformanceFor({ decay: { interval_ms: 0 } })
    expect(
      check.violations.some(
        (v) =>
          v.constraint === 'timer_override_bounds' &&
          v.field_path === 'elements[0].initial_timers.decay.interval_ms'
      )
    ).toBe(true)
  })

  it('flags a negative offset_ms override → timer_override_bounds', () => {
    const check = conformanceFor({ decay: { offset_ms: -100 } })
    expect(
      check.violations.some(
        (v) =>
          v.constraint === 'timer_override_bounds' &&
          v.field_path === 'elements[0].initial_timers.decay.offset_ms'
      )
    ).toBe(true)
  })

  it('flags an override keyed by an unknown emitter id → timer_override_emitter_registered', () => {
    const check = conformanceFor({ ghost_emitter: { interval_ms: 5 } })
    const v = check.violations.find((x) => x.constraint === 'timer_override_emitter_registered')
    expect(v?.field_path).toBe('elements[0].initial_timers.ghost_emitter')
    expect(v?.actual).toBe('ghost_emitter')
  })

  it('accepts a well-formed override (no timer_override violation)', () => {
    const check = conformanceFor({ decay: { interval_ms: 45_000, offset_ms: 10_000 } })
    expect(check.violations.some((v) => v.constraint.startsWith('timer_override_'))).toBe(false)
  })
})

describe('schema_conformance — emitter_target_reaches_terminal (decay-coverage invariant)', () => {
  it('TC-17: flags an archetype-targeted element with no consuming rule (the ring would lie)', () => {
    // The golden's archetype:plant decay emitter targets all 3 plants; drop
    // plant-3 from rule-health so it becomes emitter-targeted with no
    // health_response rule to carry the neglect event.
    const bad = cloneLevel()
    const ruleHealth = bad.rules.find((r) => r.id === 'rule-health')
    if (!ruleHealth) throw new Error('fixture rule-health missing')
    ruleHealth.target_elements = ruleHealth.target_elements.filter((id) => id !== 'plant-3')
    const report = validateLevel(gameType, bad)
    const check = checkOf(report, 'schema_conformance')
    const v = check.violations.find((x) => x.constraint === 'emitter_target_reaches_terminal')
    expect(v).toBeTruthy()
    expect(v?.related_elements).toContain('plant-3')
    expect(report.publish_ready).toBe(false)
  })

  it('TC-17: flags an incomplete decay ladder that never reaches the lose terminal', () => {
    // Keep plant-3 covered but drop the [critical, neglect, dead] row so the
    // ladder stalls at critical — the ring counts down but no plant can die.
    const bad = cloneLevel()
    const ruleHealth = bad.rules.find((r) => r.id === 'rule-health')
    if (!ruleHealth) throw new Error('fixture rule-health missing')
    ruleHealth.bindings = {
      ...ruleHealth.bindings,
      transitions: (ruleHealth.bindings.transitions as unknown[]).filter(
        (row) => !(Array.isArray(row) && row[2] === 'dead')
      ),
    }
    const check = checkOf(validateLevel(gameType, bad), 'schema_conformance')
    expect(check.violations.some((v) => v.constraint === 'emitter_target_reaches_terminal')).toBe(
      true
    )
  })

  it('passes on the v1.1.0 golden — every plant walks its neglect ladder to dead', () => {
    const check = checkOf(validateLevel(gameType, level), 'schema_conformance')
    expect(check.violations.some((v) => v.constraint === 'emitter_target_reaches_terminal')).toBe(
      false
    )
  })
})

describe('TC-33: the timed-decay fields are genuinely optional', () => {
  it('sibling GameTypes carry neither field and gain no emitter checks', () => {
    expect(rcGameType.timed_emitters).toBeUndefined()
    expect(sgGameType.timed_emitters).toBeUndefined()
    for (const gt of [rcGameType, sgGameType]) {
      expect(validateGameType(gt).violations.some((v) => v.constraint.startsWith('emitter_'))).toBe(
        false
      )
    }
  })

  it("the v1.1.0 golden's own decay emitter passes validateGameType clean", () => {
    expect(gameType.timed_emitters).toBeDefined()
    expect(
      validateGameType(gameType).violations.some((v) => v.constraint.startsWith('emitter_'))
    ).toBe(false)
  })

  it('TC-33: the v1.1.0 golden (decay + lose) reaches overall pass + publish_ready', () => {
    const report = validateLevel(gameType, level)
    expect(report.overall_verdict).toBe('pass')
    expect(report.publish_ready).toBe(true)
  })
})
