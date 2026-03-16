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
