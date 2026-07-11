import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { App } from './App'
import { PURSUER_RULE_COPY } from './engine/pursuer-rules'
import type { ShadowVoiceSource } from './voice/useShadowChaseVoice'

const BUTTON_ONLY_VOICE: ShadowVoiceSource = {
  status: 'unavailable',
  playerTranscript: '',
  companionText: '',
}

describe('playable shell semantics', () => {
  it('uses Chinese-first copy and enters frozen map-visible planning', () => {
    render(<App voiceSource={BUTTON_ONLY_VOICE} />)
    expect(screen.getByRole('heading', { name: '双影追逃' })).toBeTruthy()
    expect(screen.getByText(/收集三枚光核/)).toBeTruthy()
    expect(screen.getByText(PURSUER_RULE_COPY)).toBeTruthy()
    expect(screen.getByRole('region', { name: '追兵规则' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '查看地图并制定策略' }))
    expect(screen.getByRole('application', { name: '双影追逃地图' })).toBeTruthy()
    expect(screen.getByText('战术准备')).toBeTruthy()
    expect(screen.getByText(PURSUER_RULE_COPY)).toBeTruthy()
    expect(screen.getByRole('region', { name: '追兵规则' })).toBeTruthy()
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
    expect(screen.getByRole('button', { name: '交换位置 · 0' })).toBeTruthy()
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
