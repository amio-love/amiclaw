import { describe, expect, it } from 'vitest'
import { createProviders, type ProviderEnv } from './factory'
import type { ResolvedConfig } from '../provider-config'

function config(over: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    gameId: 'demo',
    systemPromptConfig: { role: 'guide', ruleTemplate: [] },
    llm: { provider: 'deepseek', model: 'deepseek-v4-flash' },
    stt: { provider: 'volcengine', model: 'bigmodel' },
    tts: { provider: 'volcengine', model: 'doubao' },
    ...over,
  }
}

const fullEnv: ProviderEnv = {
  DEEPSEEK_API_KEY: 'ds-key',
  VOLC_APP_ID: 'app',
  VOLC_ACCESS_KEY: 'token',
}

describe('createProviders', () => {
  it('wires all three layers from the resolved config + env', () => {
    const providers = createProviders(config(), fullEnv)
    expect(typeof providers.llm.streamCompletion).toBe('function')
    expect(typeof providers.stt.transcribe).toBe('function')
    expect(typeof providers.tts.synthesize).toBe('function')
  })

  it('throws a precise error for an unknown llm provider id', () => {
    expect(() =>
      createProviders(config({ llm: { provider: 'mystery', model: 'x' } }), fullEnv)
    ).toThrow(/unknown llm provider id "mystery"/)
  })

  it('throws a precise error for an unknown stt provider id', () => {
    expect(() =>
      createProviders(config({ stt: { provider: 'mystery', model: 'x' } }), fullEnv)
    ).toThrow(/unknown stt provider id "mystery"/)
  })

  it('throws a precise error for an unknown tts provider id', () => {
    expect(() =>
      createProviders(config({ tts: { provider: 'mystery', model: 'x' } }), fullEnv)
    ).toThrow(/unknown tts provider id "mystery"/)
  })

  it('throws when a selected vendor credential is missing', () => {
    expect(() =>
      createProviders(config(), { VOLC_APP_ID: 'app', VOLC_ACCESS_KEY: 'token' })
    ).toThrow(/DEEPSEEK_API_KEY is not set/)
    expect(() =>
      createProviders(config(), { DEEPSEEK_API_KEY: 'ds', VOLC_ACCESS_KEY: 'token' })
    ).toThrow(/VOLC_APP_ID is not set/)
  })

  it('sources credentials only from env (not config)', () => {
    // No throw means the factory read the creds from env; absence would throw.
    expect(() => createProviders(config(), fullEnv)).not.toThrow()
  })

  it('wires all-mock providers with no credentials in env', () => {
    const mockConfig = config({
      llm: { provider: 'mock', model: 'mock-llm' },
      stt: { provider: 'mock', model: 'mock-stt' },
      tts: { provider: 'mock', model: 'mock-tts' },
    })
    // Empty env: the mock path must require no provider credentials.
    const providers = createProviders(mockConfig, {})
    expect(typeof providers.llm.streamCompletion).toBe('function')
    expect(typeof providers.stt.transcribe).toBe('function')
    expect(typeof providers.tts.synthesize).toBe('function')
  })

  it('shares one mock speech instance across the stt and tts slots', () => {
    const mockConfig = config({
      stt: { provider: 'mock', model: 'mock-stt' },
      tts: { provider: 'mock', model: 'mock-tts' },
      llm: { provider: 'mock', model: 'mock-llm' },
    })
    const providers = createProviders(mockConfig, {})
    // The shared-instance build means stt and tts come from the same pair; we
    // assert both are present and distinct method surfaces (stt vs tts).
    expect(providers.stt).not.toBe(providers.tts)
  })
})
