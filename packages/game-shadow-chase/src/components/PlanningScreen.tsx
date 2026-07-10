import type { PlanningSnapshot } from '../planning/planning-controller'
import { PlanningDurationControl } from './PlanningDurationControl'
import { PursuerRule } from './PursuerRule'

export function PlanningScreen({
  planning,
  onDurationChange,
  onStartNow,
}: {
  planning: PlanningSnapshot
  onDurationChange(seconds: number): void
  onStartNow(): void
}) {
  return (
    <header className={planning.urgentSecond ? 'planning-header urgent' : 'planning-header'}>
      <div>
        <p className="eyebrow">战术准备</p>
        <h1>先看地图，再决定伙伴策略</h1>
        <p>追逃尚未开始。地图与角色保持冻结，语音连接失败也不会延长倒计时。</p>
        <PursuerRule />
      </div>
      <div className="planning-countdown" aria-label="战术准备倒计时">
        <span className="planning-countdown-label">剩余</span>
        <strong>{planning.remainingSeconds}</strong>
        <span>秒</span>
      </div>
      <PlanningDurationControl seconds={planning.selectedSeconds} onChange={onDurationChange} />
      <button className="primary-button planning-start" type="button" onClick={onStartNow}>
        立即出发
      </button>
      {planning.urgentSecond && (
        <span className="sr-only" role="status" aria-live="assertive">
          {planning.urgentSecond}
        </span>
      )}
    </header>
  )
}
