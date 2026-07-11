/**
 * Combinatorial level expansion (L2 arch note B3).
 *
 * The engine's construction model toggles the `__placed` state of
 * DESIGN-TIME-declared elements (engine.ts / rules.ts) — it has no notion of
 * the player choosing a slot at runtime. To give the player free placement we
 * pre-generate EVERY (piece_type, slot) candidate as an element, start them all
 * unplaced (`initial_state.occupied: []`), and let `place_piece` flip the one
 * the player/partner chose. 8 slots × (4 rhythm + 4 melody) = 64 candidates.
 *
 * This is engine-inert on counts: the 64-element count structurally exceeds
 * `difficulty_budget.element_count.max = 16`, so the validator's
 * budget_compliance check would FAIL — but the live engine ignores the budget
 * (it only reads elements / rules / initial_state / win_condition). That gap is
 * engine-sufficiency finding F3, confirmed in practice here.
 */

import type { Level, LevelElement, LevelRule } from '@amiclaw/creation'
import { MELODY_TYPES, RHYTHM_TYPES } from './constants'
import type { LevelConfig, Pool } from './types'

/** Deterministic element id for a (lane, type, slot) candidate. */
export function elementId(prefix: 'r' | 'm', type: string, slot: number): string {
  return `${prefix}_${type}_s${slot}`
}

function materialEntries(pool: Pool, archetype: string, typeKey: string) {
  return Object.entries(pool)
    .filter(([, count]) => (count ?? 0) > 0)
    .map(([type, count]) => ({ archetype, [typeKey]: type, count: count as number }))
}

/**
 * Expand a LevelConfig into a Level the engine can run. All 64 candidates start
 * unplaced; the harmony matrix + score threshold come from the config.
 */
export function buildLevel(cfg: LevelConfig): Level {
  const elements: LevelElement[] = []
  for (let slot = 1; slot <= cfg.slots; slot++) {
    for (const r of RHYTHM_TYPES) {
      elements.push({
        id: elementId('r', r, slot),
        archetype: 'rhythm_piece',
        params: { rhythm_type: r, timeline_slot: slot },
      })
    }
    for (const m of MELODY_TYPES) {
      elements.push({
        id: elementId('m', m, slot),
        archetype: 'melody_piece',
        params: { melody_type: m, timeline_slot: slot },
      })
    }
  }

  const matrixRows: [string, string, string][] = []
  for (const r of RHYTHM_TYPES) {
    for (const m of MELODY_TYPES) {
      matrixRows.push([r, m, cfg.matrix[r][m]])
    }
  }

  const allIds = elements.map((e) => e.id)
  const harmonyRule: LevelRule = {
    id: 'rule-harmony',
    template: 'harmony_rule',
    bindings: { matrix: matrixRows },
    target_elements: allIds,
  }

  // Role views over every element (both roles see the full shared timeline —
  // co_build). Used only by getRoleView; placement flows through performAction.
  const rhythmView = (id: string, isRhythm: boolean) => ({
    element_id: id,
    visible_attributes: isRhythm
      ? ['rhythm_type', 'timeline_slot']
      : ['melody_type', 'timeline_slot'],
    visible_states: [],
  })
  const elementViews = elements.map((e) => rhythmView(e.id, e.archetype === 'rhythm_piece'))

  return {
    metadata: {
      id: cfg.id,
      game_type: 'sound-garden',
      game_type_version: '1.0.0',
      title: cfg.name,
      author: 'sound-garden-probe',
      created_at: '2026-07-10T00:00:00+08:00',
    },
    // Engine-inert bookkeeping. element_count intentionally reflects the true
    // 64-candidate expansion (see F3) rather than a budget-legal fiction.
    difficulty: {
      element_count: elements.length,
      rule_count: 1,
      partition_complexity: 2.0,
      total_score: cfg.target,
    },
    communication_estimate: {
      round_trips: 5,
      estimated_seconds: 40,
      time_limit_seconds: 240,
      feasibility: 'feasible',
    },
    initial_state: { timeline_slots: cfg.slots, occupied: [] },
    available_materials: {
      rhythm_builder: materialEntries(cfg.rhythmPool, 'rhythm_piece', 'rhythm_type'),
      melody_builder: materialEntries(cfg.melodyPool, 'melody_piece', 'melody_type'),
    },
    elements,
    rules: [harmonyRule],
    information_partition: {
      role_assignments: [
        { role: 'rhythm_builder', element_views: elementViews },
        { role: 'melody_builder', element_views: elementViews },
      ],
    },
    win_condition: { type: 'score_threshold', params: { target_score: cfg.target } },
  }
}
