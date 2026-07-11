import { describe, it, expect } from 'vitest'
import { plantSprite, plantStateOrder, rankDelta, speciesLabel } from './visual-map'
import { botanicalGameType } from '@/data/load'

describe('visual-map', () => {
  it('swaps the glyph for death and flowering, else uses the species glyph', () => {
    expect(plantSprite('orchid', 'stable', 'seedling')).toBe('🌷')
    expect(plantSprite('orchid', 'dead', 'flowering')).toBe('🥀') // death wins over flowering
    expect(plantSprite('fern', 'thriving', 'flowering')).toBe('🌸')
  })

  it('labels species in Chinese', () => {
    expect(speciesLabel('succulent')).toBe('多肉')
  })

  it('reads the health order (worst → best) from the GameType, not a hardcode', () => {
    expect(plantStateOrder(botanicalGameType, 'health')).toEqual([
      'dead',
      'critical',
      'wilting',
      'stable',
      'thriving',
    ])
  })

  it('computes a signed rank delta within an ordered enum', () => {
    const order = plantStateOrder(botanicalGameType, 'health')
    expect(rankDelta(order, 'wilting', 'stable')).toBeGreaterThan(0) // healed
    expect(rankDelta(order, 'stable', 'critical')).toBeLessThan(0) // harmed
    expect(rankDelta(order, 'stable', 'stable')).toBe(0)
  })
})
