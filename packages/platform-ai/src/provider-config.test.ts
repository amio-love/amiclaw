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
    first.systemPromptConfig.role = 'rogue-role'

    const second = resolveConfig('demo')
    expect(second.llm.provider).toBe('deepseek')
    expect(second.llm.model).toBe('deepseek-v4-flash')
    expect(second.systemPromptConfig.role).toContain('manual-explainer')
  })
})
