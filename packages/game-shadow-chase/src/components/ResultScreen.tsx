import type { SimulationState } from '../engine/types'

function causalBeat(state: SimulationState): string {
  const event = [...state.eventLog]
    .reverse()
    .find((candidate) => ['rescue', 'swap', 'core-collected'].includes(candidate.type))
  if (!event) return 'Your companion kept moving even without a model connection.'
  if (event.type === 'rescue') return 'The rescue route kept both shadows in the chase.'
  if (event.type === 'swap') return 'The position swap changed who carried the danger.'
  return 'Your split routes brought the last light core within reach.'
}

export function ResultScreen({ state, onRestart }: { state: SimulationState; onRestart(): void }) {
  const won = state.phase === 'win'
  return (
    <main className="result-shell">
      <p className="eyebrow">Run complete</p>
      <h1>{won ? 'Both shadows made it home.' : 'The moon path closed this time.'}</h1>
      <p>{causalBeat(state)}</p>
      <dl className="result-stats">
        <div>
          <dt>Outcome</dt>
          <dd>{state.phase}</dd>
        </div>
        <div>
          <dt>Light cores</dt>
          <dd>{state.objectives.filter((objective) => objective.collected).length} / 3</dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd>{(state.tick / 4).toFixed(1)}s</dd>
        </div>
      </dl>
      <button className="primary-button" type="button" onClick={onRestart}>
        Play again
      </button>
    </main>
  )
}
