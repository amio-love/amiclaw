import { describe, it, expect } from 'vitest'
import { createRng } from './rng'
import { generateSceneInfo, INDICATOR_LABELS } from './scene-info'

describe('generateSceneInfo', () => {
  it('never produces duplicate indicator labels within a scene', () => {
    // Regression: indicators were once sampled WITH replacement (rng.pick per
    // slot), so a scene could show e.g. two "SND" chips. They are now sampled
    // without replacement, so every generated scene must have unique labels.
    for (let seed = 0; seed < 500; seed++) {
      const { indicators } = generateSceneInfo(createRng(seed))
      const labels = indicators.map((ind) => ind.label)
      expect(new Set(labels).size).toBe(labels.length)
    }
  })

  it('only emits labels from the known indicator pool', () => {
    for (let seed = 0; seed < 200; seed++) {
      const { indicators } = generateSceneInfo(createRng(seed))
      for (const ind of indicators) {
        expect(INDICATOR_LABELS).toContain(ind.label)
      }
    }
  })

  it('produces 0–3 indicators and a battery count of 1–4', () => {
    for (let seed = 0; seed < 200; seed++) {
      const { indicators, batteryCount } = generateSceneInfo(createRng(seed))
      expect(indicators.length).toBeGreaterThanOrEqual(0)
      expect(indicators.length).toBeLessThanOrEqual(3)
      expect(batteryCount).toBeGreaterThanOrEqual(1)
      expect(batteryCount).toBeLessThanOrEqual(4)
    }
  })

  it('is deterministic for a given seed', () => {
    expect(generateSceneInfo(createRng(42))).toEqual(generateSceneInfo(createRng(42)))
  })
})
