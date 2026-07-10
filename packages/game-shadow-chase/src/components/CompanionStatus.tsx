import type { SimulationState } from '../engine/types'

export function CompanionStatus({ state }: { state: SimulationState }) {
  const bark = state.activeModelLease?.bark
  const deterministic =
    state.actors.player.status === 'captured'
      ? 'I am coming back for you.'
      : state.command.intent === 'decoy'
        ? 'I will pull the pursuer away.'
        : state.command.intent === 'split'
          ? 'I will take the far route.'
          : 'I am keeping your shadow in sight.'
  return (
    <p className="companion-bark" role="status" aria-live="polite">
      <span aria-hidden="true">✦</span> {bark ?? deterministic}
    </p>
  )
}
