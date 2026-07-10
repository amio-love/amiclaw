import { MIN_RUN_TICKS, OPENING_GRACE_TICKS, RUN_CAP_TICKS, TICK_MS } from '../engine/config'
import { rescueTicksRemaining } from '../engine/reducer'
import type { SimulationState } from '../engine/types'

function formatTime(tick: number): string {
  const seconds = Math.floor((tick * TICK_MS) / 1000)
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

export function Hud({ state }: { state: SimulationState }) {
  const collected = state.objectives.filter((objective) => objective.collected).length
  const allCoresCollected = collected === state.objectives.length
  const captured = (['player', 'companion'] as const)
    .map((id) => ({ id, ticks: rescueTicksRemaining(state.actors[id], state.tick) }))
    .find((entry) => entry.ticks !== null)
  const openingTicks = Math.max(0, OPENING_GRACE_TICKS - state.tick)
  const gateStatus = state.exit.enabled
    ? 'Open'
    : allCoresCollected
      ? `Opens in ${formatTime(Math.max(0, MIN_RUN_TICKS - state.tick))}`
      : '3 cores needed'
  return (
    <header className="hud" aria-label="Chase status">
      <div>
        <span className="hud-label">Time</span>
        <strong className="hud-value">{formatTime(state.tick)}</strong>
        <span className="sr-only"> of {formatTime(RUN_CAP_TICKS)}</span>
      </div>
      <div>
        <span className="hud-label">Light cores</span>
        <strong className="hud-value">{collected} / 3</strong>
      </div>
      <div>
        <span className="hud-label">Moon gate</span>
        <strong className="hud-value">{gateStatus}</strong>
      </div>
      <div className={captured ? 'rescue-alert' : ''}>
        <span className="hud-label">Rescue</span>
        <strong className="hud-value">
          {captured
            ? `${captured.id} · ${((captured.ticks ?? 0) * TICK_MS) / 1000}s`
            : openingTicks > 0
              ? `Head start · ${(openingTicks * TICK_MS) / 1000}s`
              : 'Team safe'}
        </strong>
      </div>
    </header>
  )
}
