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
      <button
        type="button"
        aria-label="减少战术准备时间"
        disabled={seconds <= MIN_PLANNING_SECONDS}
        onClick={() => onChange(seconds - PLANNING_STEP_SECONDS)}
      >
        −
      </button>
      <span className="planning-duration-value">
        <strong>{seconds}</strong>
        <span>秒</span>
      </span>
      <button
        type="button"
        aria-label="增加战术准备时间"
        disabled={seconds >= MAX_PLANNING_SECONDS}
        onClick={() => onChange(seconds + PLANNING_STEP_SECONDS)}
      >
        ＋
      </button>
    </div>
  )
}
