import { describe, expect, it } from 'vitest'
import { resolveConfig, resolveIntentConfig } from './provider-config'

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

  it('registers a legal Volcengine ASR wire model for the demo STT layer (P2)', () => {
    // P2 regression: the demo STT model is passed verbatim into the ASR
    // `request.model_name` (factory F-K passthrough), and the Volcengine v3
    // streaming ASR endpoint accepts ONLY `bigmodel`. Guard the alias `bigmodel-asr`
    // (illegal model id → failed turn) from creeping back at the config layer.
    const { stt } = resolveConfig('demo')
    expect(stt.model).toBe('bigmodel')
    expect(stt.model).not.toBe('bigmodel-asr')
  })

  it('registers the omit-by-default TTS model sentinel for the demo TTS layer', () => {
    // The demo TTS model is the empty-string sentinel: "use the resource-id
    // default model". The factory threads it (F-K passthrough), and the adapter
    // omits `req_params.model` from the Doubao TTS 2.0 StartSession frame for an
    // empty model — so the session is bound by the paired resource id
    // (`seed-tts-2.0`) alone, matching Volcengine's first-party clients.
    // This guards a guessed concrete model token (a reject / mis-route risk) from
    // creeping back at the config layer; the exact `req_params.model` wire value
    // (`seed-tts-2.0-standard` / `-expressive` vs omitted) is a deploy-time
    // verification item, set here once confirmed.
    const { tts } = resolveConfig('demo')
    expect(tts.model).toBe('')
    expect(tts.model).not.toBe('doubao-tts-2.0')
  })

  it('a layer selection carries provider + model only (no unwired fallback field)', () => {
    // F-H regression: `fallback` was defined but never executed (createProviders
    // builds one provider per layer, runTurn calls each once and fails loud on
    // first error). The dead config field is removed; a resolved layer must be
    // exactly { provider, model } so it cannot reappear unwired. Timeout +
    // fallback is a deferred L3 followup (see provider-config.ts docblock).
    const { llm, stt, tts } = resolveConfig('demo')
    for (const layer of [llm, stt, tts]) {
      expect(Object.keys(layer).sort()).toEqual(['model', 'provider'])
    }
  })
})

describe('resolveConfig — bombsquad', () => {
  it('resolves the bombsquad game config with a Chinese defuse-expert persona and full rule discipline', () => {
    const resolved = resolveConfig('bombsquad')
    expect(resolved.gameId).toBe('bombsquad')

    const { role, ruleTemplate } = resolved.systemPromptConfig

    // Persona marker: a Chinese calm-defuse-expert voice, not an empty/stub role.
    expect(role.length).toBeGreaterThan(0)
    expect(role).toContain('拆弹')

    // The rule set carries the full discipline contract, not a placeholder:
    // manual-only + cross-module flow + ask-for-values + one-action +
    // no-recite + no-imagine + daily-strike + Chinese-voice.
    expect(ruleTemplate.length).toBeGreaterThanOrEqual(8)
    for (const rule of ruleTemplate) {
      expect(rule.length).toBeGreaterThan(0)
    }

    // Key discipline markers, asserted semantically so a future reword does not
    // break the test: defer to the manual, speak Chinese, and the daily
    // 3-strike detonation rule.
    const joined = ruleTemplate.join('\n')
    expect(joined).toContain('手册')
    expect(joined).toContain('中文')
    expect(joined).toContain('引爆')
  })

  it('mirrors the demo provider stack: DeepSeek v4 LLM + Volcengine voice', () => {
    // BombSquad runs the same verified production stack as `demo`: DeepSeek v4
    // flash LLM, Volcengine `bigmodel` ASR, and the empty-string TTS
    // resource-id-default sentinel. Only the system prompt differs.
    const { llm, stt, tts } = resolveConfig('bombsquad')
    expect(llm.provider).toBe('deepseek')
    expect(llm.model).toBe('deepseek-v4-flash')
    expect(stt.provider).toBe('volcengine')
    expect(stt.model).toBe('bigmodel')
    expect(tts.provider).toBe('volcengine')
    expect(tts.model).toBe('')
  })
})

describe('resolveConfig — companion-lobby', () => {
  it('resolves the lobby companion persona: a home-lobby greeter with no game/manual', () => {
    const resolved = resolveConfig('companion-lobby')
    expect(resolved.gameId).toBe('companion-lobby')

    const { role, ruleTemplate } = resolved.systemPromptConfig
    // Persona marker: the companion on the home lobby, not a defuse expert.
    expect(role.length).toBeGreaterThan(0)
    expect(role).toContain('大厅')
    expect(role).not.toContain('拆弹')

    // The rules forbid inventing a game/manual (there is none here) and pin the
    // brief, spoken-Chinese greeter register.
    const joined = ruleTemplate.join('\n')
    expect(joined).toContain('手册') // "…没有手册" — explicitly no manual
    expect(joined).toContain('中文')
  })

  it('mirrors the verified DeepSeek v4 LLM + Volcengine voice stack', () => {
    const { llm, stt, tts } = resolveConfig('companion-lobby')
    expect(llm.provider).toBe('deepseek')
    expect(llm.model).toBe('deepseek-v4-flash')
    expect(stt.provider).toBe('volcengine')
    expect(stt.model).toBe('bigmodel')
    expect(tts.provider).toBe('volcengine')
    expect(tts.model).toBe('')
  })
})

describe('resolveConfig — shadow chase voice', () => {
  it('resolves the full existing provider stack with a Chinese strategy persona', () => {
    const resolved = resolveConfig('shadow-chase')
    expect(resolved.gameId).toBe('shadow-chase')
    expect(resolved.llm).toEqual({ provider: 'deepseek', model: 'deepseek-v4-flash' })
    expect(resolved.stt).toEqual({ provider: 'volcengine', model: 'bigmodel' })
    expect(resolved.tts).toEqual({ provider: 'volcengine', model: '' })
    expect(resolved.systemPromptConfig.role).toContain('双影追逃')
    expect(resolved.systemPromptConfig.ruleTemplate.join('\n')).toContain('接应、探路、架点')
  })
})

describe('resolveConfig — botanical-garden', () => {
  it('resolves the companion-botanist persona: a manual-grounded botanist on the verified voice stack', () => {
    const resolved = resolveConfig('botanical-garden')
    expect(resolved.gameId).toBe('botanical-garden')
    expect(resolved.llm).toEqual({ provider: 'deepseek', model: 'deepseek-v4-flash' })
    expect(resolved.stt).toEqual({ provider: 'volcengine', model: 'bigmodel' })
    expect(resolved.tts).toEqual({ provider: 'volcengine', model: '' })
    expect(resolved.systemPromptConfig.role).toContain('植物园养护')
    expect(resolved.systemPromptConfig.role).toContain('植物学家')
    const rules = resolved.systemPromptConfig.ruleTemplate.join('\n')
    // Grounded strictly on the injected manual (the manual is ground truth)...
    expect(rules).toContain('养护手册')
    // ...and it frames the botanist duty (one action, warn about irreversibility)
    // rather than restating specific care rules (which live in the manual).
    expect(rules).toContain('一次只')
    expect(rules).toContain('不可逆')
    expect(resolved.systemPromptConfig.ruleTemplate.length).toBeGreaterThanOrEqual(5)
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

describe('resolveIntentConfig — shadow chase', () => {
  it('resolves a text-only DeepSeek selection without manufacturing STT or TTS layers', () => {
    const resolved = resolveIntentConfig('shadow-chase')
    expect(resolved.gameId).toBe('shadow-chase')
    expect(resolved.llm).toEqual({ provider: 'deepseek', model: 'deepseek-v4-flash' })
    expect(resolved.systemPromptConfig.role).toContain('companion')
    expect(Object.keys(resolved).sort()).toEqual(['gameId', 'llm', 'systemPromptConfig'])
  })

  it('throws on an unknown text-intent game instead of falling back', () => {
    expect(() => resolveIntentConfig('missing')).toThrow(/no intent configuration registered/)
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
    first.systemPromptConfig.role = 'rogue-role'

    const second = resolveConfig('demo')
    expect(second.llm.provider).toBe('deepseek')
    expect(second.llm.model).toBe('deepseek-v4-flash')
    expect(second.systemPromptConfig.role).toContain('manual-explainer')
  })
})
