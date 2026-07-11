import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { App } from './App'
import { OBJECTIVE_RULE_COPY } from './components/PursuerRule'
import { PURSUER_RULE_COPY } from './engine/pursuer-rules'
import type { ShadowVoiceSource } from './voice/useShadowChaseVoice'

const BUTTON_ONLY_VOICE: ShadowVoiceSource = {
  status: 'unavailable',
  playerTranscript: '',
  companionText: '',
}

describe('playable shell semantics', () => {
  it('leads with the objective graphic and keeps exact rules collapsed by default', () => {
    const view = render(<App voiceSource={BUTTON_ONLY_VOICE} />)
    expect(screen.getByRole('heading', { name: '双影追逃' })).toBeTruthy()
    expect(
      screen.getByLabelText('收集三枚光核，月门立即开启，两道影子一起撤离；被捕获后需要倒计时救援')
    ).toBeTruthy()
    expect(view.container.querySelectorAll('.objective-node svg')).toHaveLength(4)
    expect(OBJECTIVE_RULE_COPY).toBe(
      '收集三枚光核，月门会立即开启，再与伙伴一起抵达出口撤离。战术准备结束后追兵立即行动；任何一方被捕获，都要在倒计时结束前完成救援。'
    )
    expect(screen.getByText(OBJECTIVE_RULE_COPY)).toBeTruthy()
    expect(screen.getByText(PURSUER_RULE_COPY)).toBeTruthy()
    expect(screen.getByRole('region', { name: '追兵规则' })).toBeTruthy()
    expect(view.container.querySelector('details')?.open).toBe(false)
    for (const step of ['最短略快', '目标切换', '接触捕获', '光核换位', '三核开门']) {
      expect(screen.getByText(step)).toBeTruthy()
    }
  })

  it('enters frozen map-visible planning without expanding the exact pursuer rule', () => {
    const view = render(<App voiceSource={BUTTON_ONLY_VOICE} />)
    fireEvent.click(screen.getByRole('button', { name: '查看地图并制定策略' }))
    expect(screen.getByRole('application', { name: '双影追逃地图' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '制定策略' })).toBeTruthy()
    expect(screen.getByText('地图冻结')).toBeTruthy()
    expect(screen.getByText(PURSUER_RULE_COPY)).toBeTruthy()
    expect(screen.getByRole('region', { name: '追兵规则' })).toBeTruthy()
    expect(view.container.querySelector('details')?.open).toBe(false)
    expect(screen.getAllByText('20')).toHaveLength(2)
    expect(screen.getByRole('button', { name: '立即出发' })).toBeTruthy()
  })

  it('keeps deterministic Chinese strategy buttons available during planning and play', () => {
    render(<App voiceSource={BUTTON_ONLY_VOICE} />)
    fireEvent.click(screen.getByRole('button', { name: '查看地图并制定策略' }))
    for (const name of ['接应', '探路', '架点']) {
      expect(screen.getByRole('button', { name }).getAttribute('aria-pressed')).not.toBeNull()
    }
    fireEvent.click(screen.getByRole('button', { name: '立即出发' }))
    expect(
      screen.getByRole('button', { name: '交换位置 · 0' }).getAttribute('aria-keyshortcuts')
    ).toBe('Space')
    expect(screen.getByText('键盘可用 WASD、方向键，空格换位')).toBeTruthy()
  })

  it('adjusts the same planning duration before and during the frozen phase', () => {
    render(<App voiceSource={BUTTON_ONLY_VOICE} />)
    fireEvent.click(screen.getByRole('button', { name: '增加战术准备时间' }))
    expect(screen.getByText('25')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '查看地图并制定策略' }))
    expect(screen.getAllByText('25')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: '减少战术准备时间' }))
    expect(screen.getAllByText('20')).toHaveLength(2)
  })
})
