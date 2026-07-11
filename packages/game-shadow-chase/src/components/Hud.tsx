import { RUN_CAP_TICKS, TICK_MS } from '../engine/config'
import { rescueTicksRemaining } from '../engine/reducer'
import type { SimulationState } from '../engine/types'

function formatTime(tick: number): string {
  const seconds = Math.floor((tick * TICK_MS) / 1000)
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

export function Hud({ state }: { state: SimulationState }) {
  const collected = state.objectives.filter((objective) => objective.collected).length
  const captured = (['player', 'companion'] as const)
    .map((id) => ({ id, ticks: rescueTicksRemaining(state.actors[id], state.tick) }))
    .find((entry) => entry.ticks !== null)
  const recentRescue = [...state.eventLog]
    .reverse()
    .find((event) => event.type === 'rescue' && state.tick - event.tick <= 8)
  const gateStatus = state.exit.enabled
    ? '已开启'
    : `还需收集 ${state.objectives.length - collected} 枚光核`
  return (
    <header className="hud" aria-label="追逃状态">
      <div>
        <span className="hud-label">时间</span>
        <strong className="hud-value">{formatTime(state.tick)}</strong>
        <span className="sr-only">，上限 {formatTime(RUN_CAP_TICKS)}</span>
      </div>
      <div>
        <span className="hud-label">光核</span>
        <strong className="hud-value">{collected} / 3</strong>
      </div>
      <div>
        <span className="hud-label">月门</span>
        <strong className="hud-value">{gateStatus}</strong>
      </div>
      <div>
        <span className="hud-label">换位</span>
        <strong className="hud-value">{state.swapCharges} 次</strong>
      </div>
      <div className={captured ? 'rescue-alert' : ''}>
        <span className="hud-label">救援</span>
        <strong className="hud-value">
          {captured
            ? `${recentRescue?.actorId === captured.id ? (captured.id === 'player' ? '你再次被捕' : '伙伴再次被捕') : captured.id === 'player' ? '你' : '伙伴'} · ${((captured.ticks ?? 0) * TICK_MS) / 1000} 秒`
            : recentRescue
              ? recentRescue.actorId === 'player'
                ? '伙伴刚救下你'
                : '你刚救下伙伴'
              : '双方安全'}
        </strong>
      </div>
    </header>
  )
}
