import { describe, expect, it } from 'vitest'
import { buildAssistantPrompt } from './assistant-prompt'
import { SYMBOLS } from '@shared/symbols'

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

  it('injects every symbol id and description from the SYMBOLS registry', () => {
    const prompt = buildAssistantPrompt({ mode: 'practice', manualUrl: 'x' })
    for (const sym of SYMBOLS) {
      expect(prompt).toContain(sym.id)
      expect(prompt).toContain(sym.description)
    }
  })

  it('renders the symbol section under a "符号视觉对照" header with bold ids', () => {
    const prompt = buildAssistantPrompt({ mode: 'practice', manualUrl: 'x' })
    expect(prompt).toContain('## 符号视觉对照')
    expect(prompt).toContain('**psi**')
    expect(prompt).toContain('**trident**')
  })

  it("flags the CP4 confusions (psi vs '三叉戟', trident vs '扇子')", () => {
    const prompt = buildAssistantPrompt({ mode: 'practice', manualUrl: 'x' })
    expect(prompt).toContain('三叉戟')
    expect(prompt).toContain('扇子')
  })

  it('warns the AI not to give "rotate until you see symbol X" dial instructions', () => {
    const prompt = buildAssistantPrompt({ mode: 'practice', manualUrl: 'x' })
    expect(prompt).toContain('目标是 index，不是具体符号')
    expect(prompt).toContain('自己独立的 6 个符号池')
  })
})
