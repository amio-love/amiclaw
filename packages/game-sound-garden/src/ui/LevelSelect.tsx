/**
 * Level select + the session-start side-swap toggle (L2 arch note B3). The
 * player defaults to the melody side and may swap to rhythm before starting;
 * the harmony matrix stays hidden from the player in both assignments.
 */

import { useState } from 'react'
import { LEVELS } from '../game/levels'
import type { Side } from '../game/types'

interface LevelSelectProps {
  onStart: (levelIndex: number, side: Side) => void
}

export function LevelSelect(props: LevelSelectProps) {
  const [side, setSide] = useState<Side>('melody')

  return (
    <main className="sg-app sg-select">
      <header className="sg-select-head">
        <div className="sg-brand">声音花园</div>
        <p className="sg-brand-sub">和 AI 伙伴一起，把 8 拍时间线种成一座会唱歌的花园</p>
      </header>

      <div className="sg-sidepick">
        <span className="sg-sidepick-label">你的角色</span>
        <div className="sg-segmented" role="group" aria-label="选择你的角色">
          <button
            type="button"
            className={side === 'melody' ? 'active' : ''}
            onClick={() => setSide('melody')}
          >
            🌼 旋律花
          </button>
          <button
            type="button"
            className={side === 'rhythm' ? 'active' : ''}
            onClick={() => setSide('rhythm')}
          >
            🌱 节奏根
          </button>
        </div>
        <span className="sg-sidepick-hint">
          {side === 'melody' ? '你种旋律，伙伴铺节奏' : '你铺节奏，伙伴种旋律'}
        </span>
      </div>

      <section className="sg-levellist">
        {LEVELS.map((lv) => (
          <button
            type="button"
            className="sg-levelcard"
            key={lv.id}
            onClick={() => props.onStart(lv.index, side)}
          >
            <div className="sg-levelcard-top">
              <span className="sg-levelnum">{lv.index}</span>
              <span className="sg-levelname">{lv.name}</span>
              <span className="sg-leveltarget">目标 {lv.target}</span>
            </div>
            <div className="sg-levelsub">{lv.subtitle}</div>
            <div className="sg-leveltension">{lv.tension}</div>
          </button>
        ))}
      </section>

      <p className="sg-select-foot">自由流 · 无败绽放 · 靠听觉与伙伴提示摸索和声</p>
    </main>
  )
}
