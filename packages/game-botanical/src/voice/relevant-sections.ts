/**
 * Map the live garden state to the manual section ids the platform should
 * inject for the botanist's next turn (`GameState.relevantSections`). Pure — no
 * React, no I/O — so it is a unit-tested seam and can be signature-diffed by the
 * voice hook to steer the live session only on real change.
 *
 * Selection:
 *  - always: `objective`, `compatibility`, `light`, `health_and_decay`.
 *  - for each ACTIVE plant (health wilting/critical, OR the focused plant):
 *    its `species_care:<species>` + `danger:<species>`, plus `growth` once.
 * The result is filtered to the manual's actually-present section ids, so a
 * plant with no species-care rule (or a level with no growth section) never
 * names a non-existent section.
 */

const ALWAYS_ON = ['objective', 'compatibility', 'light', 'health_and_decay'] as const
const ACTIVE_HEALTH = new Set(['wilting', 'critical'])

export interface GardenSectionState {
  /** Live plants (ordered — pot order preserved for deterministic output). */
  plants: { id: string; species: string; health: string }[]
  /** The currently selected plant id, or null. */
  focusedId: string | null
  /** Section ids the rendered manual actually contains (`manualData.sections`). */
  availableSectionIds: string[]
}

export function gardenStateToRelevantSections(state: GardenSectionState): string[] {
  const available = new Set(state.availableSectionIds)
  const active = state.plants.filter((p) => ACTIVE_HEALTH.has(p.health) || p.id === state.focusedId)

  const ordered: string[] = ['objective']
  for (const plant of active) {
    ordered.push(`species_care:${plant.species}`, `danger:${plant.species}`)
  }
  ordered.push('compatibility', 'light')
  if (active.length > 0) ordered.push('growth')
  ordered.push('health_and_decay')

  // Keep ALWAYS_ON ids that exist even if the ordering above dropped one, filter
  // to present sections, and dedupe preserving first-seen order.
  const seen = new Set<string>()
  const result: string[] = []
  for (const id of ordered) {
    if (!available.has(id) || seen.has(id)) continue
    seen.add(id)
    result.push(id)
  }
  // Safety: guarantee the always-on ids that exist are present.
  for (const id of ALWAYS_ON) {
    if (available.has(id) && !seen.has(id)) {
      seen.add(id)
      result.push(id)
    }
  }
  return result
}
