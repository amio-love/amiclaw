import { describe, it, expect } from 'vitest'
import { gardenStateToRelevantSections } from './relevant-sections'

const AVAILABLE = [
  'objective',
  'species_care:orchid',
  'danger:fern',
  'compatibility',
  'light',
  'growth',
  'health_and_decay',
]

const plant = (id: string, species: string, health: string) => ({ id, species, health })

describe('gardenStateToRelevantSections', () => {
  it('injects only the always-on sections when nothing needs attention', () => {
    const sections = gardenStateToRelevantSections({
      plants: [plant('p1', 'fern', 'stable'), plant('p2', 'orchid', 'thriving')],
      focusedId: null,
      availableSectionIds: AVAILABLE,
    })
    expect(sections).toEqual(['objective', 'compatibility', 'light', 'health_and_decay'])
  })

  it('adds the focused plant’s species care + growth', () => {
    const sections = gardenStateToRelevantSections({
      plants: [plant('p1', 'fern', 'stable'), plant('p2', 'orchid', 'stable')],
      focusedId: 'p2',
      availableSectionIds: AVAILABLE,
    })
    expect(sections).toContain('species_care:orchid')
    expect(sections).toContain('growth')
    // danger:orchid does not exist in this manual → filtered out.
    expect(sections).not.toContain('danger:orchid')
  })

  it('adds danger for a wilting/critical plant even without focus', () => {
    const sections = gardenStateToRelevantSections({
      plants: [plant('p1', 'fern', 'wilting'), plant('p2', 'orchid', 'stable')],
      focusedId: null,
      availableSectionIds: AVAILABLE,
    })
    expect(sections).toContain('danger:fern')
    // species_care:fern is not present in the manual → filtered out.
    expect(sections).not.toContain('species_care:fern')
    expect(sections).toContain('growth')
  })

  it('steers as the garden evolves: the section set changes with focus', () => {
    const plants = [plant('p1', 'fern', 'stable'), plant('p2', 'orchid', 'stable')]
    const focusFern = gardenStateToRelevantSections({
      plants,
      focusedId: 'p1',
      availableSectionIds: AVAILABLE,
    })
    const focusOrchid = gardenStateToRelevantSections({
      plants,
      focusedId: 'p2',
      availableSectionIds: AVAILABLE,
    })
    expect(focusFern).toContain('danger:fern')
    expect(focusFern).not.toContain('species_care:orchid')
    expect(focusOrchid).toContain('species_care:orchid')
    expect(focusFern.join(',')).not.toBe(focusOrchid.join(','))
  })

  it('never names a section the manual does not contain', () => {
    const sections = gardenStateToRelevantSections({
      plants: [plant('p1', 'vine', 'critical')],
      focusedId: 'p1',
      availableSectionIds: ['objective', 'health_and_decay'], // sparse manual
    })
    expect(sections).toEqual(['objective', 'health_and_decay'])
  })
})
