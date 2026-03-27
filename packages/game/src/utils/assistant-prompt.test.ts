import { describe, expect, it } from 'vitest'
import { buildAssistantPrompt } from './assistant-prompt'

describe('buildAssistantPrompt', () => {
  it('uses the practice manual URL in practice prompts', () => {
    const prompt = buildAssistantPrompt({
      mode: 'practice',
      manualUrl: 'https://bombsquad.amio.fans/manual/practice',
    })

    expect(prompt).toContain('https://bombsquad.amio.fans/manual/practice')
    expect(prompt).toContain('This is practice mode.')
  })

  it('uses the dated manual URL in daily prompts', () => {
    const prompt = buildAssistantPrompt({
      mode: 'daily',
      manualUrl: 'https://bombsquad.amio.fans/manual/2026-03-27',
    })

    expect(prompt).toContain('https://bombsquad.amio.fans/manual/2026-03-27')
    expect(prompt).toContain('This is the daily challenge.')
  })
})
