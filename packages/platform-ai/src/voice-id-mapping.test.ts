import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertVoiceMappingReady,
  checkVoiceMappingReadiness,
  PLATFORM_VOICE_IDS,
  resolveVendorVoice,
  VOICE_ENV_BINDINGS,
  type VoiceMappingEnv,
} from './voice-id-mapping'

const COMPLETE_ENV: VoiceMappingEnv = {
  VOLC_TTS_VOICE_COMPANION_WARM: 'zh_female_warm_real_token',
  VOLC_TTS_VOICE_COMPANION_BRIGHT: 'zh_female_bright_real_token',
  VOLC_TTS_VOICE_COMPANION_CALM: 'zh_female_calm_real_token',
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('voice-id-mapping', () => {
  it('assigns a deploy env var to EVERY platform voice id', () => {
    for (const voiceId of PLATFORM_VOICE_IDS) {
      expect(VOICE_ENV_BINDINGS[voiceId]).toMatch(/^VOLC_TTS_VOICE_COMPANION_/)
    }
  })

  it('resolves a configured env mapping to its vendor voice params', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(resolveVendorVoice('companion-warm', COMPLETE_ENV)).toEqual({
      volcengineVoiceType: 'zh_female_warm_real_token',
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it('degrades an unmapped voice id to undefined with a warning — never throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(resolveVendorVoice('vendor-raw-token', COMPLETE_ENV)).toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no vendor mapping'))
  })

  it('degrades a missing deploy env token to undefined with a warning — never throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(resolveVendorVoice('companion-warm', {})).toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('missing a real deploy env'))
  })

  it('rejects placeholder-like deploy env tokens and never sends them to the vendor', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const env: VoiceMappingEnv = {
      VOLC_TTS_VOICE_COMPANION_WARM: 'PLACEHOLDER_VOLC_VOICE_TYPE_WARM',
      VOLC_TTS_VOICE_COMPANION_BRIGHT: '<real token>',
      VOLC_TTS_VOICE_COMPANION_CALM: 'TODO',
    }

    expect(checkVoiceMappingReadiness(env)).toEqual({
      ok: false,
      configured: [],
      missing: [
        { voiceId: 'companion-warm', envVar: 'VOLC_TTS_VOICE_COMPANION_WARM' },
        { voiceId: 'companion-bright', envVar: 'VOLC_TTS_VOICE_COMPANION_BRIGHT' },
        { voiceId: 'companion-calm', envVar: 'VOLC_TTS_VOICE_COMPANION_CALM' },
      ],
    })
    expect(resolveVendorVoice('companion-warm', env)).toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('missing a real deploy env'))
  })

  it('reports launch readiness when every voice env var is configured', () => {
    expect(checkVoiceMappingReadiness(COMPLETE_ENV)).toEqual({
      ok: true,
      configured: [
        {
          voiceId: 'companion-warm',
          envVar: 'VOLC_TTS_VOICE_COMPANION_WARM',
          volcengineVoiceType: 'zh_female_warm_real_token',
        },
        {
          voiceId: 'companion-bright',
          envVar: 'VOLC_TTS_VOICE_COMPANION_BRIGHT',
          volcengineVoiceType: 'zh_female_bright_real_token',
        },
        {
          voiceId: 'companion-calm',
          envVar: 'VOLC_TTS_VOICE_COMPANION_CALM',
          volcengineVoiceType: 'zh_female_calm_real_token',
        },
      ],
      missing: [],
    })
    expect(() => assertVoiceMappingReady(COMPLETE_ENV)).not.toThrow()
  })

  it('fails launch readiness loudly when any deploy voice env var is missing', () => {
    const incomplete: VoiceMappingEnv = {
      VOLC_TTS_VOICE_COMPANION_WARM: 'zh_female_warm_real_token',
      VOLC_TTS_VOICE_COMPANION_BRIGHT: '  ',
    }
    const readiness = checkVoiceMappingReadiness(incomplete)
    expect(readiness.ok).toBe(false)
    expect(readiness.missing).toEqual([
      { voiceId: 'companion-bright', envVar: 'VOLC_TTS_VOICE_COMPANION_BRIGHT' },
      { voiceId: 'companion-calm', envVar: 'VOLC_TTS_VOICE_COMPANION_CALM' },
    ])
    expect(() => assertVoiceMappingReady(incomplete)).toThrow(
      /companion-bright -> VOLC_TTS_VOICE_COMPANION_BRIGHT/
    )
  })
})
