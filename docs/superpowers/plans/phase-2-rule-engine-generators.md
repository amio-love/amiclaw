# Phase 2: Rule Engine + Puzzle Generators

> **Part of:** [BombSquad MVP Development](2026-03-12-bombsquad-mvp-development.md)
> **Prerequisites:** Phase 1 complete (PRNG available, shared types scaffolded, Vitest configured)
> **Delivers to:** Phase 3 (generators needed for module UI) and Phase 4 (rule engine for manual loading)

---

## Goal

Build the core game logic: a condition-matching rule engine that parses YAML manuals, plus all 4 puzzle generators and solvers with full unit test coverage. After this phase, the game's logic is complete and independently testable — no UI needed.

---

## Architecture

```
packages/game/src/
├── engine/
│   ├── rule-engine.ts          ← condition matcher (the critical piece)
│   ├── rule-engine.test.ts
│   └── answer-validator.ts     ← validates player answers against solved answers
├── modules/
│   ├── wire/
│   │   ├── types.ts
│   │   ├── generator.ts        ← generates random WireConfig
│   │   ├── solver.ts           ← computes correct WireAnswer from config + rules
│   │   └── solver.test.ts
│   ├── dial/
│   │   ├── types.ts
│   │   ├── generator.ts
│   │   ├── solver.ts
│   │   └── solver.test.ts
│   ├── button/
│   │   ├── types.ts
│   │   ├── generator.ts
│   │   ├── solver.ts
│   │   └── solver.test.ts
│   └── keypad/
│       ├── types.ts
│       ├── generator.ts
│       ├── solver.ts
│       └── solver.test.ts
shared/
└── manual-schema.ts            ← extended with all module config + answer types
packages/manual/
└── data/
    └── practice.yaml           ← ~30 real rules + 20 decoy rules
```

---

## Tech Stack

Same as Phase 1. No new dependencies. Uses `js-yaml` (already installed) for parsing YAML in tests.

---

## Tasks

### Extend shared types

- [ ] **Task 2.1** — Extend `shared/manual-schema.ts` with module config and answer types:

  ```typescript
  // --- Wire module ---
  export type WireColor = 'red' | 'blue' | 'yellow' | 'green' | 'white' | 'black'

  export interface Wire {
    color: WireColor
    hasStripe: boolean
    stripeColor?: WireColor
  }

  export interface WireConfig {
    wires: Wire[]   // 4 or 5 elements, ordered top-to-bottom
  }

  export interface WireAnswer {
    type: 'wire'
    cutPosition: number   // 0-indexed position to cut
  }

  // --- Dial module ---
  export interface DialConfig {
    dials: string[][]   // 3 dials × 6 symbol ids each
    currentPositions: number[]   // current index for each dial (0–5)
  }

  export interface DialAnswer {
    type: 'dial'
    positions: number[]   // target index for each dial (0–5)
  }

  // --- Button module ---
  export interface ButtonConfig {
    color: string        // e.g. 'red', 'blue', 'yellow', 'white'
    label: string        // e.g. 'ABORT', 'DETONATE', 'HOLD', 'PRESS'
    indicatorColor: string
    displayNumber: number
  }

  export interface ButtonAnswer {
    type: 'button'
    action: 'tap' | 'hold'
    releaseOnColor?: string   // only when action === 'hold'
  }

  // --- Keypad module ---
  export interface KeypadConfig {
    symbols: string[]   // 4 symbol ids in the 2×2 grid (row-major: TL, TR, BL, BR)
  }

  export interface KeypadAnswer {
    type: 'keypad'
    sequence: number[]   // 0-indexed positions in click order (length 4)
  }

  // --- Union types ---
  export type ModuleConfig = WireConfig | DialConfig | ButtonConfig | KeypadConfig
  export type ModuleAnswer = WireAnswer | DialAnswer | ButtonAnswer | KeypadAnswer
  export type ModuleType = 'wire' | 'dial' | 'button' | 'keypad'
  ```

- [ ] **Task 2.2** — Add rule types to `shared/manual-schema.ts`:

  ```typescript
  // Condition operators for rule matching
  export type CompareOp = { gt: number } | { gte: number } | { lt: number } | { lte: number }
  export type BoolOp = { odd: boolean } | { even: boolean }
  export type CountOp = { count_red: CompareOp | number } | { count_blue: CompareOp | number }
    // (extend for each color as needed)

  export interface WireRule {
    condition: Record<string, unknown>   // flexible — matched by rule engine
    action: 'cut_wire'
    target: {
      position: 'first' | 'last' | number   // 0-indexed number or keyword
      color?: WireColor
    }
  }

  export interface ButtonRule {
    condition: Record<string, unknown>
    action: { type: 'tap' } | { type: 'hold'; release_on_light: string }
  }

  export interface DialManualSection {
    columns: string[][]   // 6 columns × 6 symbol ids each
    rule: string          // human-readable description (for reference)
  }

  export interface KeypadManualSection {
    sequences: string[][]   // 6 sequences × 6 symbol ids each
    rule: string
  }

  export interface ManualModules {
    wire_routing: { rules: WireRule[] }
    symbol_dial: DialManualSection
    button: { rules: ButtonRule[] }
    keypad: KeypadManualSection
  }

  // Update Manual interface
  export interface Manual {
    meta: ManualMeta
    modules: ManualModules
    decoy_modules?: Record<string, unknown>
  }
  ```

### Rule engine

- [ ] **Task 2.3** — Create `packages/game/src/engine/rule-engine.ts`:

  This is the most critical file. It must handle all condition operators:

  ```typescript
  import type { SceneInfo, WireConfig, ButtonConfig } from '@shared/manual-schema'

  /**
   * Evaluates a single condition value against an actual value.
   * Supports: exact equality, {gt}, {gte}, {lt}, {lte}, {odd}, {even}, boolean
   */
  export function matchValue(condition: unknown, actual: unknown): boolean {
    if (condition === null || condition === undefined) return true
    if (typeof condition === 'object' && condition !== null) {
      const c = condition as Record<string, unknown>
      if ('gt' in c) return typeof actual === 'number' && actual > (c.gt as number)
      if ('gte' in c) return typeof actual === 'number' && actual >= (c.gte as number)
      if ('lt' in c) return typeof actual === 'number' && actual < (c.lt as number)
      if ('lte' in c) return typeof actual === 'number' && actual <= (c.lte as number)
      if ('odd' in c) return typeof actual === 'number' && (actual % 2 !== 0) === c.odd
      if ('even' in c) return typeof actual === 'number' && (actual % 2 === 0) === c.even
      if ('present' in c) return (actual !== undefined && actual !== null) === c.present
    }
    return condition === actual
  }

  /**
   * Matches a condition object against module config + scene info.
   * Returns true if ALL keys in the condition match.
   */
  export function matchCondition(
    condition: Record<string, unknown>,
    config: Record<string, unknown>,
    sceneInfo: SceneInfo,
  ): boolean {
    const context = buildContext(config, sceneInfo)
    return Object.entries(condition).every(([key, value]) => {
      if (!(key in context)) return false
      return matchValue(value, context[key])
    })
  }

  /**
   * Builds a flat context object from module config + scene info
   * for condition key lookups.
   */
  function buildContext(
    config: Record<string, unknown>,
    sceneInfo: SceneInfo,
  ): Record<string, unknown> {
    const ctx: Record<string, unknown> = { ...config }

    // Scene info fields
    ctx['battery_count'] = sceneInfo.batteryCount
    ctx['serial_number'] = sceneInfo.serialNumber
    ctx['serial_last_digit'] = parseInt(sceneInfo.serialNumber.slice(-1), 10) || 0
    ctx['serial_has_vowel'] = /[AEIOU]/i.test(sceneInfo.serialNumber)

    // Indicator lookups: indicator_{label}_lit (e.g. indicator_FRK_lit)
    for (const ind of sceneInfo.indicators) {
      ctx[`indicator_${ind.label}_lit`] = ind.lit
    }

    // Wire-specific computed fields
    if (Array.isArray(config['wires'])) {
      const wires = config['wires'] as Array<{ color: string; hasStripe: boolean }>
      ctx['wire_count'] = wires.length
      ctx['color_at_last'] = wires[wires.length - 1]?.color
      ctx['color_at_first'] = wires[0]?.color
      // Count each color
      for (const color of ['red', 'blue', 'yellow', 'green', 'white', 'black']) {
        ctx[`count_${color}`] = wires.filter(w => w.color === color).length
      }
    }

    return ctx
  }
  ```

- [ ] **Task 2.4** — Create `packages/game/src/engine/rule-engine.test.ts`:

  Test every operator type with known inputs:

  ```typescript
  import { describe, it, expect } from 'vitest'
  import { matchValue, matchCondition } from './rule-engine'
  import type { SceneInfo } from '@shared/manual-schema'

  const sceneInfo: SceneInfo = {
    serialNumber: 'A7K3B9',
    batteryCount: 3,
    indicators: [{ label: 'FRK', lit: true }, { label: 'CAR', lit: false }],
  }

  describe('matchValue', () => {
    it('equality: exact match', () => expect(matchValue('red', 'red')).toBe(true))
    it('equality: mismatch', () => expect(matchValue('red', 'blue')).toBe(false))
    it('{gt} operator', () => {
      expect(matchValue({ gt: 2 }, 3)).toBe(true)
      expect(matchValue({ gt: 2 }, 2)).toBe(false)
    })
    it('{gte} operator', () => {
      expect(matchValue({ gte: 3 }, 3)).toBe(true)
      expect(matchValue({ gte: 3 }, 2)).toBe(false)
    })
    it('{lt} operator', () => expect(matchValue({ lt: 4 }, 3)).toBe(true))
    it('{lte} operator', () => expect(matchValue({ lte: 3 }, 3)).toBe(true))
    it('{odd: true} matches odd numbers', () => {
      expect(matchValue({ odd: true }, 3)).toBe(true)
      expect(matchValue({ odd: true }, 4)).toBe(false)
    })
    it('{even: true} matches even numbers', () => {
      expect(matchValue({ even: true }, 4)).toBe(true)
      expect(matchValue({ even: true }, 3)).toBe(false)
    })
    it('{present: true} checks existence', () => {
      expect(matchValue({ present: true }, 'something')).toBe(true)
      expect(matchValue({ present: true }, null)).toBe(false)
    })
  })

  describe('matchCondition', () => {
    it('matches wire_count exactly', () => {
      const config = { wires: [{ color: 'red', hasStripe: false }, { color: 'blue', hasStripe: false },
        { color: 'yellow', hasStripe: false }, { color: 'green', hasStripe: false }] }
      expect(matchCondition({ wire_count: 4 }, config, sceneInfo)).toBe(true)
      expect(matchCondition({ wire_count: 5 }, config, sceneInfo)).toBe(false)
    })

    it('matches battery_count with {gt}', () => {
      const config = {}
      expect(matchCondition({ battery_count: { gt: 2 } }, config, sceneInfo)).toBe(true)
      expect(matchCondition({ battery_count: { gt: 3 } }, config, sceneInfo)).toBe(false)
    })

    it('matches indicator lit status', () => {
      const config = {}
      expect(matchCondition({ indicator_FRK_lit: true }, config, sceneInfo)).toBe(true)
      expect(matchCondition({ indicator_CAR_lit: true }, config, sceneInfo)).toBe(false)
    })

    it('matches color_at_last', () => {
      const config = { wires: [{ color: 'red', hasStripe: false }, { color: 'blue', hasStripe: false }] }
      expect(matchCondition({ color_at_last: 'blue' }, config, sceneInfo)).toBe(true)
    })

    it('matches serial_last_digit with {odd}', () => {
      // serialNumber ends in '9' → odd
      expect(matchCondition({ serial_last_digit: { odd: true } }, {}, sceneInfo)).toBe(true)
    })

    it('all conditions must match (AND logic)', () => {
      const config = { wires: Array(4).fill({ color: 'red', hasStripe: false }) }
      expect(matchCondition({ wire_count: 4, battery_count: { gt: 2 } }, config, sceneInfo)).toBe(true)
      expect(matchCondition({ wire_count: 4, battery_count: { gt: 5 } }, config, sceneInfo)).toBe(false)
    })
  })
  ```

### Answer validator

- [ ] **Task 2.5** — Create `packages/game/src/engine/answer-validator.ts`:

  ```typescript
  import type { ModuleAnswer } from '@shared/manual-schema'

  /**
   * Validates that a player's action matches the solved answer.
   * Returns true if the action is correct.
   */
  export function validateAnswer(solved: ModuleAnswer, playerAction: unknown): boolean {
    switch (solved.type) {
      case 'wire': {
        const action = playerAction as { cutPosition: number }
        return action.cutPosition === solved.cutPosition
      }
      case 'dial': {
        const action = playerAction as { positions: number[] }
        return (
          action.positions.length === solved.positions.length &&
          action.positions.every((p, i) => p === solved.positions[i])
        )
      }
      case 'button': {
        const action = playerAction as { actionType: 'tap' | 'hold'; releasedOnColor?: string }
        if (action.actionType !== solved.action) return false
        if (solved.action === 'hold' && action.releasedOnColor !== solved.releaseOnColor) return false
        return true
      }
      case 'keypad': {
        const action = playerAction as { sequence: number[] }
        return (
          action.sequence.length === solved.sequence.length &&
          action.sequence.every((p, i) => p === solved.sequence[i])
        )
      }
    }
  }
  ```

### Wire module

- [ ] **Task 2.6** — Create `packages/game/src/modules/wire/types.ts`:

  Re-export from shared for convenience, add any wire-specific UI types:
  ```typescript
  export type { WireConfig, WireAnswer, Wire, WireColor } from '@shared/manual-schema'
  ```

- [ ] **Task 2.7** — Create `packages/game/src/modules/wire/solver.ts`:

  ```typescript
  import type { WireConfig, WireAnswer, SceneInfo } from '@shared/manual-schema'
  import type { ManualModules } from '@shared/manual-schema'
  import { matchCondition } from '../../engine/rule-engine'

  /**
   * Finds the first matching rule and returns the cut target.
   * Returns null if no rule matches (should not happen with a valid manual).
   */
  export function solveWire(
    config: WireConfig,
    rules: ManualModules['wire_routing']['rules'],
    sceneInfo: SceneInfo,
  ): WireAnswer | null {
    for (const rule of rules) {
      if (matchCondition(rule.condition, config as unknown as Record<string, unknown>, sceneInfo)) {
        const pos = resolvePosition(rule.target, config)
        if (pos === null) continue
        return { type: 'wire', cutPosition: pos }
      }
    }
    return null
  }

  function resolvePosition(
    target: { position: 'first' | 'last' | number; color?: string },
    config: WireConfig,
  ): number | null {
    const { wires } = config
    if (target.position === 'first') {
      if (target.color) {
        const idx = wires.findIndex(w => w.color === target.color)
        return idx >= 0 ? idx : null
      }
      return 0
    }
    if (target.position === 'last') {
      if (target.color) {
        // last wire of given color
        let idx = -1
        for (let i = 0; i < wires.length; i++) {
          if (wires[i].color === target.color) idx = i
        }
        return idx >= 0 ? idx : null
      }
      return wires.length - 1
    }
    // Numeric position (0-indexed)
    const n = target.position as number
    return n >= 0 && n < wires.length ? n : null
  }
  ```

- [ ] **Task 2.8** — Create `packages/game/src/modules/wire/generator.ts`:

  ```typescript
  import type { WireConfig, WireAnswer, SceneInfo } from '@shared/manual-schema'
  import type { ManualModules } from '@shared/manual-schema'
  import type { Rng } from '../../engine/rng'
  import { solveWire } from './solver'

  const COLORS = ['red', 'blue', 'yellow', 'green', 'white', 'black'] as const

  /**
   * Generates a random WireConfig that has exactly one valid answer.
   * Rejects and retries if the config is ambiguous. Max 100 attempts.
   */
  export function generateWire(
    rng: Rng,
    rules: ManualModules['wire_routing']['rules'],
    sceneInfo: SceneInfo,
    wireCount: 4 | 5 = 4,
  ): { config: WireConfig; answer: WireAnswer } {
    for (let attempt = 0; attempt < 100; attempt++) {
      const wires = Array.from({ length: wireCount }, () => ({
        color: rng.pick(COLORS) as string,
        hasStripe: rng.float() < 0.3,
        stripeColor: rng.float() < 0.3 ? rng.pick(COLORS) as string : undefined,
      }))
      const config: WireConfig = { wires }
      const answer = solveWire(config, rules, sceneInfo)
      if (answer !== null) return { config, answer }
    }
    throw new Error('Wire generator exhausted 100 attempts — check manual rules coverage')
  }
  ```

- [ ] **Task 2.9** — Create `packages/game/src/modules/wire/solver.test.ts`:

  ```typescript
  import { describe, it, expect } from 'vitest'
  import { solveWire } from './solver'
  import { generateWire } from './generator'
  import { createRng } from '../../engine/rng'
  import type { SceneInfo, WireRule } from '@shared/manual-schema'

  const sceneInfo: SceneInfo = {
    serialNumber: 'A7K3B9',
    batteryCount: 3,
    indicators: [{ label: 'FRK', lit: true }],
  }

  const rules: WireRule[] = [
    { condition: { wire_count: 4, color_at_last: 'red' }, action: 'cut_wire', target: { position: 'last' } },
    { condition: { wire_count: 4, count_blue: { gt: 1 } }, action: 'cut_wire', target: { position: 'first', color: 'blue' } },
    { condition: { wire_count: 5 }, action: 'cut_wire', target: { position: 2 } },
    // Fallback
    { condition: {}, action: 'cut_wire', target: { position: 'first' } },
  ]

  describe('solveWire', () => {
    it('matches rule by color_at_last', () => {
      const config = {
        wires: [
          { color: 'blue', hasStripe: false },
          { color: 'yellow', hasStripe: false },
          { color: 'green', hasStripe: false },
          { color: 'red', hasStripe: false },
        ],
      }
      const answer = solveWire(config, rules, sceneInfo)
      expect(answer).toEqual({ type: 'wire', cutPosition: 3 })
    })

    it('returns null when no rule matches (empty rules)', () => {
      const config = { wires: [{ color: 'red', hasStripe: false }] }
      expect(solveWire(config, [], sceneInfo)).toBeNull()
    })
  })

  describe('generateWire', () => {
    it('generates 100 valid configs without throwing', () => {
      const rng = createRng(42)
      for (let i = 0; i < 100; i++) {
        const { config, answer } = generateWire(rng, rules, sceneInfo)
        expect(answer).not.toBeNull()
        expect(answer.cutPosition).toBeGreaterThanOrEqual(0)
        expect(answer.cutPosition).toBeLessThan(config.wires.length)
      }
    })

    it('is deterministic with same seed', () => {
      const rules2 = [...rules]
      const { config: c1, answer: a1 } = generateWire(createRng(99), rules2, sceneInfo)
      const { config: c2, answer: a2 } = generateWire(createRng(99), rules2, sceneInfo)
      expect(c1).toEqual(c2)
      expect(a1).toEqual(a2)
    })
  })
  ```

### Dial module

- [ ] **Task 2.10** — Create `packages/game/src/modules/dial/types.ts`:
  ```typescript
  export type { DialConfig, DialAnswer } from '@shared/manual-schema'
  ```

- [ ] **Task 2.11** — Create `packages/game/src/modules/dial/solver.ts`:

  ```typescript
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
  ```

- [ ] **Task 2.12** — Create `packages/game/src/modules/dial/generator.ts`:

  ```typescript
  import type { DialConfig, DialAnswer, SceneInfo } from '@shared/manual-schema'
  import type { ManualModules } from '@shared/manual-schema'
  import type { Rng } from '../../engine/rng'
  import { solveDial } from './solver'

  export function generateDial(
    rng: Rng,
    section: ManualModules['symbol_dial'],
    sceneInfo: SceneInfo,
  ): { config: DialConfig; answer: DialAnswer } {
    const allSymbols = [...new Set(section.columns.flat())]

    for (let attempt = 0; attempt < 100; attempt++) {
      // Build 3 dials, each with 6 symbols from the pool
      const dials = Array.from({ length: 3 }, () => rng.shuffle(allSymbols).slice(0, 6))
      // Start at position 0 for each dial
      const currentPositions = [0, 0, 0]
      const config: DialConfig = { dials, currentPositions }
      const answer = solveDial(config, section, sceneInfo)
      if (answer !== null) return { config, answer }
    }
    throw new Error('Dial generator exhausted 100 attempts')
  }
  ```

- [ ] **Task 2.13** — Create `packages/game/src/modules/dial/solver.test.ts` — tests for known column lookups + 100 random generation rounds.

### Button module

- [ ] **Task 2.14** — Create `packages/game/src/modules/button/types.ts`:
  ```typescript
  export type { ButtonConfig, ButtonAnswer } from '@shared/manual-schema'
  ```

- [ ] **Task 2.15** — Create `packages/game/src/modules/button/solver.ts`:

  ```typescript
  import type { ButtonConfig, ButtonAnswer, SceneInfo } from '@shared/manual-schema'
  import type { ManualModules } from '@shared/manual-schema'
  import { matchCondition } from '../../engine/rule-engine'

  export function solveButton(
    config: ButtonConfig,
    rules: ManualModules['button']['rules'],
    sceneInfo: SceneInfo,
  ): ButtonAnswer | null {
    for (const rule of rules) {
      if (matchCondition(
        rule.condition,
        config as unknown as Record<string, unknown>,
        sceneInfo,
      )) {
        return {
          type: 'button',
          action: rule.action.type,
          releaseOnColor: rule.action.type === 'hold' ? rule.action.release_on_light : undefined,
        }
      }
    }
    return null
  }
  ```

- [ ] **Task 2.16** — Create `packages/game/src/modules/button/generator.ts`:

  ```typescript
  import type { ButtonConfig, ButtonAnswer, SceneInfo } from '@shared/manual-schema'
  import type { ManualModules } from '@shared/manual-schema'
  import type { Rng } from '../../engine/rng'
  import { solveButton } from './solver'

  const COLORS = ['red', 'blue', 'yellow', 'white']
  const LABELS = ['ABORT', 'DETONATE', 'HOLD', 'PRESS']

  export function generateButton(
    rng: Rng,
    rules: ManualModules['button']['rules'],
    sceneInfo: SceneInfo,
  ): { config: ButtonConfig; answer: ButtonAnswer } {
    for (let attempt = 0; attempt < 100; attempt++) {
      const config: ButtonConfig = {
        color: rng.pick(COLORS),
        label: rng.pick(LABELS),
        indicatorColor: rng.pick(COLORS),
        displayNumber: rng.intBetween(1, 9),
      }
      const answer = solveButton(config, rules, sceneInfo)
      if (answer !== null) return { config, answer }
    }
    throw new Error('Button generator exhausted 100 attempts')
  }
  ```

- [ ] **Task 2.17** — Create `packages/game/src/modules/button/solver.test.ts` — tests for tap vs hold conditions + 100 random generation rounds.

### Keypad module

- [ ] **Task 2.18** — Create `packages/game/src/modules/keypad/types.ts`:
  ```typescript
  export type { KeypadConfig, KeypadAnswer } from '@shared/manual-schema'
  ```

- [ ] **Task 2.19** — Create `packages/game/src/modules/keypad/solver.ts`:

  ```typescript
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
  ```

- [ ] **Task 2.20** — Create `packages/game/src/modules/keypad/generator.ts`:

  ```typescript
  import type { KeypadConfig, KeypadAnswer, SceneInfo } from '@shared/manual-schema'
  import type { ManualModules } from '@shared/manual-schema'
  import type { Rng } from '../../engine/rng'
  import { solveKeypad } from './solver'

  export function generateKeypad(
    rng: Rng,
    section: ManualModules['keypad'],
    sceneInfo: SceneInfo,
  ): { config: KeypadConfig; answer: KeypadAnswer } {
    const allSymbols = [...new Set(section.sequences.flat())]

    for (let attempt = 0; attempt < 100; attempt++) {
      const symbols = rng.shuffle(allSymbols).slice(0, 4)
      const config: KeypadConfig = { symbols }
      const answer = solveKeypad(config, section, sceneInfo)
      if (answer !== null) return { config, answer }
    }
    throw new Error('Keypad generator exhausted 100 attempts')
  }
  ```

- [ ] **Task 2.21** — Create `packages/game/src/modules/keypad/solver.test.ts` — tests for known sequence lookups + 100 random generation rounds.

### Practice manual YAML

- [ ] **Task 2.22** — Create `packages/manual/data/practice.yaml`:

  This is the first real manual content. It must have:
  - Wire: 15+ rules covering all `wire_count` × `color_at_last` combinations
  - Dial: 6 columns × 6 symbols (use symbol ids from `shared/symbols.ts`)
  - Button: 10+ rules covering all `color` × `label` combinations, mix of tap/hold
  - Keypad: 6 sequences × 6 symbols each
  - 20+ decoy modules (morse_code, maze, memory, simon_says — with plausible but irrelevant rules)

  Structure:
  ```yaml
  meta:
    version: "practice"
    type: practice

  modules:
    wire_routing:
      rules:
        - condition: { wire_count: 4, color_at_last: "red" }
          action: "cut_wire"
          target: { position: "last" }
        - condition: { wire_count: 4, color_at_last: "blue" }
          action: "cut_wire"
          target: { position: "first" }
        # ... 15+ rules total ...

    symbol_dial:
      columns:
        - ["omega", "psi", "star", "delta", "xi", "diamond"]
        - ["psi", "diamond", "omega", "star", "xi", "delta"]
        - ["star", "xi", "delta", "psi", "diamond", "omega"]
        - ["delta", "star", "diamond", "xi", "omega", "psi"]
        - ["xi", "delta", "psi", "omega", "star", "diamond"]
        - ["diamond", "omega", "xi", "star", "psi", "delta"]
      rule: "Find the column containing all 3 dial symbols. Set each dial to that symbol's position in the column."

    button:
      rules:
        - condition: { color: "blue", label: "ABORT" }
          action: { type: "hold", release_on_light: "white" }
        - condition: { battery_count: { gt: 2 }, label: "DETONATE" }
          action: { type: "tap" }
        - condition: { color: "red", indicator_FRK_lit: true }
          action: { type: "tap" }
        # ... 10+ rules total ...

    keypad:
      sequences:
        - ["omega", "delta", "psi", "xi", "diamond", "star"]
        - ["star", "xi", "omega", "delta", "diamond", "psi"]
        - ["psi", "diamond", "star", "omega", "delta", "xi"]
        - ["delta", "omega", "xi", "diamond", "psi", "star"]
        - ["diamond", "psi", "delta", "star", "xi", "omega"]
        - ["xi", "star", "diamond", "psi", "omega", "delta"]
      rule: "Find the sequence containing all 4 keypad symbols. Press them in the order they appear in that sequence."

  decoy_modules:
    morse_code:
      # 6 irrelevant but realistic-looking rules
    maze:
      # 5 irrelevant maze rules
    memory:
      # 6 irrelevant memory rules
    simon_says:
      # 5 irrelevant Simon Says rules
  ```

### Integration test

- [ ] **Task 2.23** — Create `packages/game/src/engine/integration.test.ts`:

  Load `practice.yaml` → generate all 4 modules → solve all → verify answers are valid:

  ```typescript
  import { describe, it, expect } from 'vitest'
  import { readFileSync } from 'fs'
  import { resolve } from 'path'
  import yaml from 'js-yaml'
  import type { Manual, SceneInfo } from '@shared/manual-schema'
  import { createRng } from './rng'
  import { generateWire } from '../modules/wire/generator'
  import { generateDial } from '../modules/dial/generator'
  import { generateButton } from '../modules/button/generator'
  import { generateKeypad } from '../modules/keypad/generator'

  const manual = yaml.load(
    readFileSync(resolve(__dirname, '../../../manual/data/practice.yaml'), 'utf8')
  ) as Manual

  const sceneInfo: SceneInfo = {
    serialNumber: 'A7K3B9',
    batteryCount: 3,
    indicators: [{ label: 'FRK', lit: true }],
  }

  describe('integration: practice manual → generate + solve all modules', () => {
    it('generates and solves all 4 modules 10 times without error', () => {
      const rng = createRng(42)
      for (let i = 0; i < 10; i++) {
        const wire = generateWire(rng, manual.modules.wire_routing.rules, sceneInfo)
        expect(wire.answer.type).toBe('wire')

        const dial = generateDial(rng, manual.modules.symbol_dial, sceneInfo)
        expect(dial.answer.type).toBe('dial')
        expect(dial.answer.positions).toHaveLength(3)

        const button = generateButton(rng, manual.modules.button.rules, sceneInfo)
        expect(button.answer.type).toBe('button')

        const keypad = generateKeypad(rng, manual.modules.keypad, sceneInfo)
        expect(keypad.answer.type).toBe('keypad')
        expect(keypad.answer.sequence).toHaveLength(4)
      }
    })
  })
  ```

---

## Verification

```bash
# From workspace root
pnpm test:run
```

**Expected output:** All tests pass, including:
- `rule-engine.test.ts` — ~12 tests
- `modules/wire/solver.test.ts` — ~4 tests
- `modules/dial/solver.test.ts` — ~4 tests
- `modules/button/solver.test.ts` — ~4 tests
- `modules/keypad/solver.test.ts` — ~4 tests
- `engine/integration.test.ts` — 1 test (10 full game loops)

**Checklist:**
- [ ] All unit tests pass
- [ ] Integration test passes
- [ ] Generator never throws for practice manual
- [ ] `solveWire` returns `null` only for empty rule list
- [ ] `solveButton` handles both `tap` and `hold` action types
- [ ] Rule engine handles all operators: `gt`, `gte`, `lt`, `lte`, `odd`, `even`, `present`

---

## Key Files Created in This Phase

| File | Role |
|------|------|
| `shared/manual-schema.ts` | Extended with module config/answer/rule types |
| `packages/game/src/engine/rule-engine.ts` | Condition matcher — core logic |
| `packages/game/src/engine/rule-engine.test.ts` | Exhaustive operator tests |
| `packages/game/src/engine/answer-validator.ts` | Player action validation |
| `packages/game/src/engine/integration.test.ts` | Full pipeline integration test |
| `packages/game/src/modules/wire/solver.ts` | Wire rule evaluation |
| `packages/game/src/modules/wire/generator.ts` | Wire config generation |
| `packages/game/src/modules/wire/solver.test.ts` | Wire solver + generator tests |
| `packages/game/src/modules/dial/solver.ts` | Dial column lookup |
| `packages/game/src/modules/dial/generator.ts` | Dial config generation |
| `packages/game/src/modules/dial/solver.test.ts` | Dial tests |
| `packages/game/src/modules/button/solver.ts` | Button rule evaluation |
| `packages/game/src/modules/button/generator.ts` | Button config generation |
| `packages/game/src/modules/button/solver.test.ts` | Button tests |
| `packages/game/src/modules/keypad/solver.ts` | Keypad sequence lookup |
| `packages/game/src/modules/keypad/generator.ts` | Keypad config generation |
| `packages/game/src/modules/keypad/solver.test.ts` | Keypad tests |
| `packages/manual/data/practice.yaml` | Practice manual — 30+ real rules + 20 decoy |
