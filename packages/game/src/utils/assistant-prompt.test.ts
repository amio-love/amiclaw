import { describe, expect, it } from 'vitest'
import { buildAssistantPrompt } from './assistant-prompt'

describe('buildAssistantPrompt', () => {
  it('uses the practice manual URL in practice prompts', () => {
    const prompt = buildAssistantPrompt({
      mode: 'practice',
      manualUrl: 'https://bombsquad.amio.fans/manual/practice',
    })

    expect(prompt).toContain('https://bombsquad.amio.fans/manual/practice')
    expect(prompt).toContain('这是练习模式')
  })

  it('uses the dated manual URL in daily prompts', () => {
    const prompt = buildAssistantPrompt({
      mode: 'daily',
      manualUrl: 'https://bombsquad.amio.fans/manual/2026-03-27',
    })

    expect(prompt).toContain('https://bombsquad.amio.fans/manual/2026-03-27')
    expect(prompt).toContain('这是每日挑战')
  })

  it('includes the Scene Info opening move for both modes', () => {
    for (const mode of ['practice', 'daily'] as const) {
      const prompt = buildAssistantPrompt({ mode, manualUrl: 'x' })
      expect(prompt).toContain('场景信息栏')
      expect(prompt).toContain('序列号')
      expect(prompt).toContain('指示灯')
    }
  })
})
