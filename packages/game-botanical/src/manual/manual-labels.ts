/**
 * PLAYER-LAYER display labels used only by the manual renderer, keyed by the
 * engine's ASCII enum values. Species / health / growth / light glosses are
 * reused from visual-map (the app's single label source); the maps here cover
 * the manual-only vocabulary (relations, action verbs, soil, state + predicate
 * field names). Every lookup falls back to the raw ASCII value, so an enum the
 * fixture adds later never crashes the renderer — it just shows the raw value
 * until a label is added.
 */

/** compatibility_matrix relation → Chinese label. */
export const RELATION_LABEL: Record<string, string> = {
  compatible: '相容',
  incompatible: '相克',
  synergy: '协同',
  neutral: '中性',
  modifies: '影响',
}

/** action_type → Chinese verb (the 5 care verbs + the mis-care overwater). */
export const ACTION_LABEL: Record<string, string> = {
  water: '浇水',
  overwater: '过量浇水',
  shade: '遮光',
  fertilize: '施肥',
  repot: '换盆',
  bloom: '催花',
}

/** soil_type → Chinese label (not carried in the fixture display_labels). */
export const SOIL_LABEL: Record<string, string> = {
  sandy: '沙土',
  loamy: '壤土',
  peaty: '泥炭土',
}

/** plant state name → Chinese label (used in the objective + health sections). */
export const STATE_NAME_LABEL: Record<string, string> = {
  health: '健康',
  growth_stage: '生长阶段',
  effective_light: '实际光照',
}

/** predicate/attribute field name → Chinese label (used in preconditions). */
export const FIELD_LABEL: Record<string, string> = {
  species: '品种',
  effective_light: '光照',
  light_level: '光照',
  growth_stage: '生长阶段',
  soil_type: '土壤',
  health: '健康',
}
