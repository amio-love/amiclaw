import type { Difficulty } from '../engine/types'
import { PlanningDurationControl } from './PlanningDurationControl'
import { PursuerRule } from './PursuerRule'

interface StartScreenProps {
  difficulty: Difficulty
  mapId: string
  planningSeconds: number
  onDifficultyChange(value: Difficulty): void
  onMapChange(value: string): void
  onPlanningSecondsChange(value: number): void
  onStart(): void
}

export function StartScreen(props: StartScreenProps) {
  return (
    <main className="start-shell">
      <p className="eyebrow">AMIO Arcade · 一名玩家与一位 AI 伙伴</p>
      <h1>双影追逃</h1>
      <p className="secondary-title">Dual Shadow Chase</p>
      <p className="start-rule">
        收集三枚光核，坚持到月门在 02:00
        开启，与伙伴一起撤离。战术准备结束后追兵立即行动；任何一方被捕获，都要在倒计时结束前完成救援。
      </p>
      <PursuerRule />
      <div className="start-options" aria-label="本局设置">
        <label>
          难度
          <select
            value={props.difficulty}
            onChange={(event) => props.onDifficultyChange(event.target.value as Difficulty)}
          >
            <option value="relaxed">轻松</option>
            <option value="standard">标准</option>
            <option value="intense">紧张</option>
          </select>
        </label>
        <label>
          地图
          <select value={props.mapId} onChange={(event) => props.onMapChange(event.target.value)}>
            <option value="courtyard">星辉庭院</option>
            <option value="crossroads">月下十字路</option>
            <option value="moon-vault">月影秘库</option>
          </select>
        </label>
      </div>
      <div className="start-planning-option">
        <span>战术准备时长</span>
        <PlanningDurationControl
          seconds={props.planningSeconds}
          onChange={props.onPlanningSecondsChange}
        />
      </div>
      <button className="primary-button" type="button" onClick={props.onStart}>
        查看地图并制定策略
      </button>
      <p className="control-hint">追逃开始后可用 WASD、方向键、方向按钮或点击地图移动。</p>
    </main>
  )
}
