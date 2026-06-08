import { describe, expect, it } from 'vitest'
import { resolveConfig } from './provider-config'

describe('resolveConfig — hit', () => {
  it('resolves the built-in demo game config', () => {
    const resolved = resolveConfig('demo')
    expect(resolved.gameId).toBe('demo')
    expect(resolved.systemPromptConfig.role).toContain('manual-explainer')
    expect(resolved.systemPromptConfig.ruleTemplate.length).toBeGreaterThan(0)
  })

  it('registers the spec defaults for the demo game: DeepSeek v4 LLM, Volcengine voice', () => {
    const { llm, stt, tts } = resolveConfig('demo')
    expect(llm.provider).toBe('deepseek')
    expect(llm.model).toBe('deepseek-v4-flash')
    expect(stt.provider).toBe('volcengine')
    expect(tts.provider).toBe('volcengine')
  })

  it('carries a fallback chain on the LLM layer', () => {
    const { llm } = resolveConfig('demo')
    expect(llm.fallback).toEqual(['deepseek-v4-pro'])
  })
})

describe('resolveConfig — miss', () => {
  it('throws an explicit error on an unregistered gameId (no silent fallback)', () => {
    expect(() => resolveConfig('not-a-real-game')).toThrowError(
      /no configuration registered for gameId "not-a-real-game"/
    )
  })

  it('names the known gameIds in the miss error to aid debugging', () => {
    expect(() => resolveConfig('missing')).toThrowError(/Known gameIds: .*demo/)
  })
})

describe('resolveConfig — switchability and isolation', () => {
  it('switchability is read-faithful: every resolve reports the same registered selection', () => {
    // The registry is the single switch point — switching a vendor is an edit
    // to the registered config, and resolveConfig reports exactly what is
    // registered, so a config edit (not a game-logic change) is what flips the
    // provider. We prove the read-faithful half here: two resolves of the same
    // game report identical selections.
    const a = resolveConfig('demo')
    const b = resolveConfig('demo')
    expect(a.llm).toEqual(b.llm)
    expect(a.stt).toEqual(b.stt)
    expect(a.tts).toEqual(b.tts)
  })

  it('returns an isolated deep copy — mutating a resolved config cannot corrupt the registry', () => {
    // The flip side of switchability: the registry must be the ONLY switch
    // point, so a caller that mutates a resolved object must not silently
    // rewire every later resolve. This guards the "switch vendor = edit config
    // only" property against accidental in-flight mutation.
    const first = resolveConfig('demo')
    first.llm.provider = 'rogue-mutation'
    first.llm.model = 'rogue-model'
    first.llm.fallback.push('rogue-fallback')
    first.systemPromptConfig.role = 'rogue-role'

    const second = resolveConfig('demo')
    expect(second.llm.provider).toBe('deepseek')
    expect(second.llm.model).toBe('deepseek-v4-flash')
    expect(second.llm.fallback).toEqual(['deepseek-v4-pro'])
    expect(second.systemPromptConfig.role).toContain('manual-explainer')
  })
})
