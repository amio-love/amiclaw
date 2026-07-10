/**
 * The five gardener care verbs (PLAYER-LAYER data). Each maps a Chinese verb
 * card to the engine `apply_care` action_type that drives the state-transition
 * tables via action_event_mapping. Order matches the tutorial care loop:
 * water / shade heal + adjust light; fertilize / repot / bloom advance growth.
 */
export interface CareVerb {
  /** apply_care action_type — the engine-facing value. */
  actionType: string
  /** Chinese verb-card label. */
  label: string
}

export const CARE_VERBS: CareVerb[] = [
  { actionType: 'water', label: '浇水' },
  { actionType: 'shade', label: '遮光' },
  { actionType: 'fertilize', label: '施肥' },
  { actionType: 'repot', label: '换盆' },
  { actionType: 'bloom', label: '催花' },
]
