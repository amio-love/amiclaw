/**
 * Companion-context injection seam tests:
 *  - `assembleLlmContext` injects the companion block isomorphic to the
 *    manual (deterministic, server-side, single system message), and is
 *    byte-identical to the pre-companion prompt when no context is present;
 *  - `assembleSession` threads the resolved context + gameRunId into the
 *    published session state (mock-verified, no D1 involved);
 *  - `assembleSession` resolves the companion `voice_id` to the vendor TTS
 *    speaker (degrading to the provider default on a mapping gap — assembly
 *    never fails on voice resolution).
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CompanionContext } from '../../companion-memory/src/types'
import type { ManualData } from './contract'
import { assembleLlmContext } from './manual-injection'
import { assembleSession } from './session-assembly'
import * as volcengine from './providers/volcengine'
import * as voiceMapping from './voice-id-mapping'

const MANUAL: ManualData = { version: 'v1', sections: { wires: { rule: 'cut red' } } }

const CONTEXT: CompanionContext = {
  companion: { name: 'Ami', address_style: 'captain', voice_id: 'companion-warm' },
  claims: [{ dimension: 'play-style', claim: 'Stays calm under pressure' }],
  episodes: [
    {
      title: 'The last-second defuse',
      narrative: 'We cut the right wire with three seconds left.',
      occurred_at: '2026-06-10T10:00:00.000Z',
      game_id: 'bombsquad',
    },
  ],
}

const BASE_INPUT = {
  systemPromptConfig: { role: 'You are a partner.', ruleTemplate: ['Be precise.'] },
  manualData: MANUAL,
  gameState: { relevantSections: ['wires'] },
}

describe('assembleLlmContext — companion injection', () => {
  it('is byte-identical to the pre-companion prompt when no context is given', () => {
    const withoutField = assembleLlmContext(BASE_INPUT)
    const withUndefined = assembleLlmContext({ ...BASE_INPUT })
    expect(withoutField).toEqual(withUndefined)
    expect(withoutField).toHaveLength(1)
    expect(withoutField[0].content).not.toContain('Companion memory')
  })

  it('appends the companion block to the single system message', () => {
    const messages = assembleLlmContext({ ...BASE_INPUT, companionContext: CONTEXT })
    expect(messages).toHaveLength(1)
    expect(messages[0].role).toBe('system')
    const content = messages[0].content
    // Manual injection is untouched; the companion block rides after it.
    expect(content).toContain('Manual (version v1)')
    expect(content).toContain('Companion memory (platform-injected):')
    expect(content).toContain('Your name is Ami.')
    expect(content).toContain('Address the player as "captain".')
    expect(content).toContain('[play-style] Stays calm under pressure')
    expect(content).toContain('The last-second defuse')
  })

  it('injects identity only (no claim / memory sections) for a fresh companion', () => {
    const messages = assembleLlmContext({
      ...BASE_INPUT,
      companionContext: { ...CONTEXT, claims: [], episodes: [] },
    })
    const content = messages[0].content
    expect(content).toContain('Your name is Ami.')
    expect(content).not.toContain('What you understand about the player:')
    expect(content).not.toContain('Shared memories')
  })

  it('is deterministic: same inputs, byte-identical output', () => {
    const a = assembleLlmContext({ ...BASE_INPUT, companionContext: CONTEXT })
    const b = assembleLlmContext({ ...BASE_INPUT, companionContext: CONTEXT })
    expect(a).toEqual(b)
  })
})

describe('assembleSession — companion extras threading', () => {
  it('publishes companionContext + gameRunId into the session state', () => {
    const assembled = assembleSession(
      'demo-mock',
      'user-a',
      MANUAL,
      undefined,
      {},
      {
        companionContext: CONTEXT,
        gameRunId: 'run-1',
      }
    )
    expect(assembled.state.companionContext).toEqual(CONTEXT)
    expect(assembled.state.gameRunId).toBe('run-1')
  })

  it('omits both fields entirely when no extras are given (pre-companion shape)', () => {
    const assembled = assembleSession('demo-mock', 'user-a', MANUAL, undefined, {})
    expect('companionContext' in assembled.state).toBe(false)
    expect('gameRunId' in assembled.state).toBe(false)
  })
})

describe('assembleSession — companion voice wiring', () => {
  // The `demo` game selects volcengine on both voice slots, so the speaker
  // threading is observable on the adapter factory's options.
  const VOLC_ENV = { DEEPSEEK_API_KEY: 'ds', VOLC_APP_ID: 'app', VOLC_ACCESS_KEY: 'token' }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('threads a resolved vendor voice into the TTS provider as the speaker', () => {
    const speech = vi.spyOn(volcengine, 'createVolcengineSpeechProvider')
    vi.spyOn(voiceMapping, 'resolveVendorVoice').mockReturnValue({
      volcengineVoiceType: 'zh_female_warm_real_token',
    })
    assembleSession('demo', 'user-a', MANUAL, undefined, VOLC_ENV, { companionContext: CONTEXT })
    expect(voiceMapping.resolveVendorVoice).toHaveBeenCalledWith('companion-warm')
    expect(speech).toHaveBeenCalledWith(
      expect.objectContaining({ ttsSpeaker: 'zh_female_warm_real_token' })
    )
  })

  it('degrades to the provider default voice on a placeholder/missing mapping — never throws', () => {
    const speech = vi.spyOn(volcengine, 'createVolcengineSpeechProvider')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // The committed mapping is all PLACEHOLDER_* tokens, so the real resolver
    // degrades here — assembly must still succeed, with no speaker override.
    const assembled = assembleSession('demo', 'user-a', MANUAL, undefined, VOLC_ENV, {
      companionContext: CONTEXT,
    })
    expect(assembled.state.companionContext).toEqual(CONTEXT)
    expect(speech).toHaveBeenCalledWith(expect.objectContaining({ ttsSpeaker: undefined }))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unfilled placeholder'))
  })

  it('does not consult the voice mapping without a companion context (zero behavior change)', () => {
    const speech = vi.spyOn(volcengine, 'createVolcengineSpeechProvider')
    const resolve = vi.spyOn(voiceMapping, 'resolveVendorVoice')
    assembleSession('demo', 'user-a', MANUAL, undefined, VOLC_ENV)
    expect(resolve).not.toHaveBeenCalled()
    expect(speech).toHaveBeenCalledWith(expect.objectContaining({ ttsSpeaker: undefined }))
  })
})
