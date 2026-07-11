import { BackLink, Button, Chip, PageHeader } from '@amiclaw/ui'

import type { Difficulty } from '../engine/types'
import { PlanningDurationControl } from './PlanningDurationControl'
import { PursuerRule } from './PursuerRule'
import { CoreIcon, GateIcon, RescueIcon, ShadowsIcon } from './ShadowChaseIcons'

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
      <PageHeader
        className="start-header"
        back={<BackLink variant="inline" label="AMIO Arcade" href="/" />}
        eyebrow={
          <div className="start-eyebrow">
            <span>一名玩家 · 一位 AI 伙伴</span>
            <Chip variant="live">可游玩</Chip>
          </div>
        }
        title={<span className="game-title">双影追逃</span>}
        lead={<span className="secondary-title">Dual Shadow Chase</span>}
      />

      <div
        className="objective-flow"
        aria-label="收集三枚光核，月门立即开启，两道影子一起撤离；被捕获后需要倒计时救援"
      >
        <span className="objective-node objective-core">
          <CoreIcon />
          <strong>×3</strong>
        </span>
        <span className="objective-arrow" aria-hidden="true">
          →
        </span>
        <span className="objective-node">
          <GateIcon />
          <strong>开启</strong>
        </span>
        <span className="objective-arrow" aria-hidden="true">
          →
        </span>
        <span className="objective-node objective-shadows">
          <ShadowsIcon />
          <strong>撤离</strong>
        </span>
        <span className="objective-node objective-rescue">
          <RescueIcon />
          <strong>救援</strong>
        </span>
      </div>

      <div className="setup-grid">
        <section className="ritual-card" aria-label="双影仪式图形">
          <div className="shadow-ritual" aria-hidden="true">
            <span className="shadow-glyph" />
            <span className="shadow-glyph companion" />
          </div>
          <p>两道影子，一条归路</p>
        </section>

        <section className="settings-card" aria-label="本局设置">
          <h2>本局设置</h2>
          <div className="start-options">
            <label>
              难度
              <select
                value={props.difficulty}
                onChange={(event) => props.onDifficultyChange(event.target.value as Difficulty)}
              >
                <option value="relaxed">轻松 · 每 2 秒多走 1 格</option>
                <option value="standard">标准 · 每 1.5 秒多走 1 格</option>
                <option value="intense">紧张 · 每 1 秒多走 1 格</option>
              </select>
            </label>
            <label>
              地图
              <select
                value={props.mapId}
                onChange={(event) => props.onMapChange(event.target.value)}
              >
                <option value="courtyard">星辉庭院</option>
                <option value="crossroads">月下十字路</option>
                <option value="moon-vault">月影秘库</option>
              </select>
            </label>
          </div>
          <div className="start-planning-option">
            <span>战术准备</span>
            <PlanningDurationControl
              seconds={props.planningSeconds}
              onChange={props.onPlanningSecondsChange}
            />
          </div>
          <PursuerRule includeObjective />
          <Button variant="primary" full onClick={props.onStart}>
            查看地图并制定策略
          </Button>
          <p className="control-hint">WASD · 方向键 · 点击地图 · Space 换位</p>
        </section>
      </div>
    </main>
  )
}
