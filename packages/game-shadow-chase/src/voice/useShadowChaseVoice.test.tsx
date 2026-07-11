import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { CompanionIntent } from '../engine/types'
import { useShadowChaseVoice, type ShadowVoiceSource } from './useShadowChaseVoice'

function VoiceHarness({
  source,
  onStrategy,
}: {
  source: ShadowVoiceSource
  onStrategy(intent: CompanionIntent): void
}) {
  useShadowChaseVoice(source, onStrategy)
  return null
}

describe('Shadow voice authority seam', () => {
  it('dispatches only one command per final player utterance sequence', () => {
    const onStrategy = vi.fn()
    const source: ShadowVoiceSource = {
      status: 'listening',
      playerTranscript: '去光核探路',
      companionText: '我建议去光核探路',
      finalPlayerUtterance: { sequence: 7, text: '去光核探路' },
    }
    const view = render(<VoiceHarness source={source} onStrategy={onStrategy} />)
    expect(onStrategy).toHaveBeenCalledTimes(1)
    expect(onStrategy).toHaveBeenCalledWith('scout')
    view.rerender(<VoiceHarness source={{ ...source }} onStrategy={onStrategy} />)
    expect(onStrategy).toHaveBeenCalledTimes(1)
  })

  it('never derives authority from assistant text alone', () => {
    const onStrategy = vi.fn()
    render(
      <VoiceHarness
        source={{
          status: 'speaking',
          playerTranscript: '',
          companionText: '我建议去远处架点',
        }}
        onStrategy={onStrategy}
      />
    )
    expect(onStrategy).not.toHaveBeenCalled()
  })
})
