import { describe, it, expect } from 'vitest'
import { buildBotanicalManualData } from './manual-data'
import { botanicalGameType, levelById } from '@/data/load'

describe('buildBotanicalManualData', () => {
  it('projects the rendered manual into the platform-ai ManualData shape', () => {
    const data = buildBotanicalManualData(botanicalGameType, levelById('bg-demo-001').level)
    expect(data.version).toBe('1.1.0')
    // Addressable sections keyed by stable section id.
    expect(Object.keys(data.sections)).toContain('objective')
    expect(Object.keys(data.sections)).toContain('species_care:orchid')
    const objective = data.sections['objective'] as { title: string; lines: string[] }
    expect(objective.title).toBe('目标与败局')
    expect(Array.isArray(objective.lines)).toBe(true)
  })

  it('keys sections for the standard level too (data-driven)', () => {
    const data = buildBotanicalManualData(botanicalGameType, levelById('bg-standard-001').level)
    expect(Object.keys(data.sections)).toContain('compatibility')
    expect(Object.keys(data.sections)).toContain('species_care:orchid')
    // The standard level has no needs-rule danger section (mis-care is wrong_care).
    expect(Object.keys(data.sections)).not.toContain('danger:fern')
  })
})
