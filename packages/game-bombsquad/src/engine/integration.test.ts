import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import yaml from 'js-yaml'
import type { Manual, SceneInfo } from '@shared/manual-schema'
import { createRng } from './rng'
import { generateSceneInfo } from './scene-info'
import { generateWire } from '../modules/wire/generator'
import { generateDial } from '../modules/dial/generator'
import { generateButton } from '../modules/button/generator'
import { generateKeypad } from '../modules/keypad/generator'
import { solveWire } from '../modules/wire/solver'
import { solveKeypad } from '../modules/keypad/solver'
import { MODULE_SEQUENCE } from '../store/game-context'

const manual = yaml.load(
  readFileSync(resolve(__dirname, '../../../manual/data/practice.yaml'), 'utf8')
) as Manual

const sceneInfo: SceneInfo = {
  sceneTongueTwister: '四是四十是十',
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

// --- B18: practice-run instance rotation --------------------------------------
//
// Practice no longer pins a constant seed: every run draws a fresh wall-clock
// seed (utils/session.ts getRunSeed), so the practice bomb re-randomizes per
// run within the permanently-fixed practice manual's rule space. These tests
// replay GamePage's load effect for a practice run (scene first, then the
// practice module sequence in order) and pin three properties: instances vary
// across seeds, every instance conforms to the practice manual, and every
// seed yields a solvable run (the same guarantee the daily generator gives).

/** Mirror of GamePage's load effect for one practice run at a given seed. */
function generatePracticeRun(seed: number) {
  const rng = createRng(seed)
  const scene = generateSceneInfo(rng)
  const modules = MODULE_SEQUENCE.practice.map((kind) => {
    switch (kind) {
      case 'wire':
        return { kind, ...generateWire(rng, manual.modules.wire_routing.rules, scene) }
      case 'dial':
        return { kind, ...generateDial(rng, manual.modules.symbol_dial, scene) }
      case 'button':
        return { kind, ...generateButton(rng, manual.modules.button.rules, scene) }
      case 'keypad':
        return { kind, ...generateKeypad(rng, manual.modules.keypad, scene) }
    }
  })
  return { scene, modules }
}

describe('B18: practice runs rotate their puzzle instance', () => {
  it('practice plays wire + keypad (the sequence this suite mirrors)', () => {
    expect(MODULE_SEQUENCE.practice).toEqual(['wire', 'keypad'])
  })

  it('draws different instances across run seeds with overwhelming probability', () => {
    const distinct = new Set<string>()
    const seedCount = 40
    for (let i = 0; i < seedCount; i++) {
      const { modules } = generatePracticeRun(1000 + i)
      distinct.add(JSON.stringify(modules.map((m) => m.config)))
    }
    // A handful of collisions is statistically fine; a frozen instance is not.
    expect(distinct.size).toBeGreaterThanOrEqual(seedCount - 4)
  })

  it('every generated instance conforms to the practice manual rules', () => {
    for (let i = 0; i < 100; i++) {
      const { scene, modules } = generatePracticeRun(20_000 + i * 7)
      for (const m of modules) {
        if (m.kind === 'wire') {
          // The pre-solved answer is exactly what first-match rule evaluation
          // yields for this config — the instance sits inside the manual's rule space.
          expect(solveWire(m.config, manual.modules.wire_routing.rules, scene)).toEqual(m.answer)
          expect(m.answer.cutPosition).toBeGreaterThanOrEqual(0)
          expect(m.answer.cutPosition).toBeLessThan(m.config.wires.length)
        }
        if (m.kind === 'keypad') {
          // The visible 4-symbol subset must belong to exactly one manual
          // sequence (set-discrimination invariant), and the pre-solved press
          // order must be what the solver derives from that sequence.
          const containing = manual.modules.keypad.sequences.filter((seq) =>
            m.config.symbols.every((sym) => seq.includes(sym))
          )
          expect(containing).toHaveLength(1)
          expect(solveKeypad(m.config, manual.modules.keypad, scene)).toEqual(m.answer)
        }
      }
    }
  })

  it('stays solvable across wall-clock-magnitude seeds (daily-grade guarantee)', () => {
    const baseSeed = 1_779_451_200_000 // timestamp magnitude, like Date.now()
    for (let i = 0; i < 300; i++) {
      const { modules } = generatePracticeRun(baseSeed + i * 977)
      for (const m of modules) {
        expect(m.answer).not.toBeNull()
      }
    }
  })
})
