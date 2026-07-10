import { describe, expect, it } from 'vitest'
import {
  assembleLlmContext,
  PUBLIC_GAME_CONTEXT_FENCE_CLOSE,
  PUBLIC_GAME_CONTEXT_FENCE_OPEN,
  type GameState,
} from './manual-injection'
import type { ManualData } from './contract'
import type { SystemPromptConfig } from './provider-config'

const systemPromptConfig: SystemPromptConfig = {
  role: 'You are the demo manual-explainer partner.',
  ruleTemplate: ['Only use the provided manual.', 'Give one next action at a time.'],
}

const manualData: ManualData = {
  version: '2026-06-08',
  sections: {
    wire_routing: { rules: ['cut the third wire if two batteries'] },
    keypad: { sequences: ['psi', 'omega'] },
    button: { rules: ['hold if red'] },
  },
}

describe('assembleLlmContext — system prompt', () => {
  it('puts role and every rule into the single system message', () => {
    const messages = assembleLlmContext({
      systemPromptConfig,
      manualData,
      gameState: { relevantSections: [] },
    })
    expect(messages).toHaveLength(1)
    expect(messages[0].role).toBe('system')
    expect(messages[0].content).toContain('You are the demo manual-explainer partner.')
    expect(messages[0].content).toContain('Only use the provided manual.')
    expect(messages[0].content).toContain('Give one next action at a time.')
  })

  it('handles an empty rule template by emitting just the role line', () => {
    const messages = assembleLlmContext({
      systemPromptConfig: { role: 'Bare role.', ruleTemplate: [] },
      manualData,
      gameState: { relevantSections: [] },
    })
    expect(messages[0].content).toContain('Bare role.')
    expect(messages[0].content).not.toContain('Rules:')
  })
})

describe('assembleLlmContext — manual subset selection by game state', () => {
  it('injects optional public game context inside a data fence', () => {
    const messages = assembleLlmContext({
      systemPromptConfig,
      manualData,
      gameState: {
        relevantSections: [],
        publicContext: { version: 1, phase: 'planning', strategy: 'follow' },
      },
    })
    expect(messages[0].content).toContain(PUBLIC_GAME_CONTEXT_FENCE_OPEN)
    expect(messages[0].content).toContain('"phase":"planning"')
    expect(messages[0].content).toContain(PUBLIC_GAME_CONTEXT_FENCE_CLOSE)
  })

  it('injects only the sections named by game state, in the requested order', () => {
    const gameState: GameState = { relevantSections: ['keypad', 'wire_routing'] }
    const messages = assembleLlmContext({ systemPromptConfig, manualData, gameState })
    const content = messages[0].content
    expect(content).toContain('### keypad')
    expect(content).toContain('### wire_routing')
    // The unselected section must NOT appear.
    expect(content).not.toContain('### button')
    // Order: keypad heading precedes wire_routing heading.
    expect(content.indexOf('### keypad')).toBeLessThan(content.indexOf('### wire_routing'))
  })

  it('silently drops unknown section ids rather than throwing', () => {
    const gameState: GameState = { relevantSections: ['wire_routing', 'does_not_exist'] }
    const messages = assembleLlmContext({ systemPromptConfig, manualData, gameState })
    expect(messages[0].content).toContain('### wire_routing')
    expect(messages[0].content).not.toContain('does_not_exist')
  })

  it('emits an explicit "no relevant sections" marker when nothing is selected', () => {
    const messages = assembleLlmContext({
      systemPromptConfig,
      manualData,
      gameState: { relevantSections: [] },
    })
    expect(messages[0].content).toContain('no relevant manual sections')
  })

  it('includes the manual version for provenance', () => {
    const messages = assembleLlmContext({
      systemPromptConfig,
      manualData,
      gameState: { relevantSections: ['button'] },
    })
    expect(messages[0].content).toContain('2026-06-08')
  })

  it('is deterministic: identical inputs yield byte-identical messages', () => {
    const gameState: GameState = { relevantSections: ['button', 'keypad'] }
    const a = assembleLlmContext({ systemPromptConfig, manualData, gameState })
    const b = assembleLlmContext({ systemPromptConfig, manualData, gameState })
    expect(a).toEqual(b)
  })
})

describe('assembleLlmContext — server-side-only confinement', () => {
  it('keeps all prompt and manual material in the system role, never in a client-facing role', () => {
    const messages = assembleLlmContext({
      systemPromptConfig,
      manualData,
      gameState: { relevantSections: ['wire_routing', 'keypad', 'button'] },
    })
    // Every message produced here must be a system message — the role/rules and
    // the injected manual subset are server-side material. No user/assistant
    // message (the roles that round-trip toward the client/transcript) may
    // carry this content. This is the structural guard for "system prompt and
    // manual stay server-side, never client-held".
    for (const message of messages) {
      expect(message.role).toBe('system')
    }
    const clientFacing = messages.filter((m) => m.role === 'user' || m.role === 'assistant')
    expect(clientFacing).toHaveLength(0)
  })
})
