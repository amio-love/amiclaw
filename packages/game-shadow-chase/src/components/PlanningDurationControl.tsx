import { IconButton } from '@amiclaw/ui'

import {
  MAX_PLANNING_SECONDS,
  MIN_PLANNING_SECONDS,
  PLANNING_STEP_SECONDS,
} from '../planning/planning-controller'

export function PlanningDurationControl({
  seconds,
  onChange,
}: {
  seconds: number
  onChange(seconds: number): void
}) {
  return (
    <div className="planning-duration" aria-label="战术准备时长">
      <IconButton
        label="减少战术准备时间"
        variant="bare"
        disabled={seconds <= MIN_PLANNING_SECONDS}
        onClick={() => onChange(seconds - PLANNING_STEP_SECONDS)}
      >
        −
      </IconButton>
      <span className="planning-duration-value">
        <strong>{seconds}</strong>
        <span>秒</span>
      </span>
      <IconButton
        label="增加战术准备时间"
        variant="bare"
        disabled={seconds >= MAX_PLANNING_SECONDS}
        onClick={() => onChange(seconds + PLANNING_STEP_SECONDS)}
      >
        ＋
      </IconButton>
    </div>
  )
}
