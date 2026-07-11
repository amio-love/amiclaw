import { Button, Chip } from '@amiclaw/ui'

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
      <div className="planning-title">
        <Chip variant="dev">地图冻结</Chip>
        <h1>制定策略</h1>
      </div>
      <div className="planning-countdown" aria-label="战术准备倒计时">
        <strong>{planning.remainingSeconds}</strong>
        <span>秒</span>
      </div>
      <div className="planning-duration-wrap">
        <span className="planning-duration-label">准备时长</span>
        <PlanningDurationControl seconds={planning.selectedSeconds} onChange={onDurationChange} />
      </div>
      <PursuerRule />
      <Button variant="primary" className="planning-start" onClick={onStartNow}>
        立即出发
      </Button>
      {planning.urgentSecond && (
        <span className="sr-only" role="status" aria-live="assertive">
          {planning.urgentSecond}
        </span>
      )}
    </header>
  )
}
