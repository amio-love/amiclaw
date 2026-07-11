import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { createRunningState } from '../engine/rules'
import type { ShadowVoiceStatus, ShadowVoiceView } from '../voice/useShadowChaseVoice'
import { StrategyPanel } from './StrategyPanel'

function voice(status: ShadowVoiceStatus, actions: { start?: () => void; stop?: () => void }) {
  return {
    status,
    playerTranscript: '',
    companionText: '',
    commandResult: null,
    ...actions,
  } satisfies ShadowVoiceView
}

function panel(activeVoice: ShadowVoiceView) {
  return (
    <StrategyPanel
      state={createRunningState('courtyard', 'standard', 7)}
      activeIntent="support"
      planning={false}
      voice={activeVoice}
      onStrategy={vi.fn()}
      onSwap={vi.fn()}
    />
  )
}

describe('StrategyPanel voice controls', () => {
  it('exposes Space as the swap keyboard shortcut', () => {
    render(panel(voice('unavailable', {})))

    expect(
      screen.getByRole('button', { name: '交换位置 · 0' }).getAttribute('aria-keyshortcuts')
    ).toBe('Space')
  })

  it.each(['connecting', 'ready', 'listening', 'thinking', 'speaking'] as const)(
    'offers a 44px manual stop control while voice is %s',
    (status) => {
      const stop = vi.fn()
      render(panel(voice(status, { stop })))

      const button = screen.getByRole('button', { name: '停止伙伴语音' })
      expect(button.className).toContain('voice-control')
      fireEvent.click(button)
      expect(stop).toHaveBeenCalledTimes(1)
      for (const label of ['接应', '探路', '架点']) {
        expect(screen.getByRole('button', { name: label })).toBeTruthy()
      }
    }
  )

  it('replaces stop with explicit reopen after the session closes', () => {
    const stop = vi.fn()
    const start = vi.fn()
    const view = render(panel(voice('listening', { stop })))

    fireEvent.click(screen.getByRole('button', { name: '停止伙伴语音' }))
    expect(stop).toHaveBeenCalledTimes(1)
    view.rerender(panel(voice('closed', { start })))

    expect(screen.queryByRole('button', { name: '停止伙伴语音' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '开启伙伴语音' }))
    expect(start).toHaveBeenCalledTimes(1)
  })
})
