import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PLATFORM_VOICE_IDS,
  resolveVendorVoice,
  VOICE_MAPPING,
  type VendorVoiceParams,
} from './voice-id-mapping'

const FILLED: Record<string, VendorVoiceParams> = {
  'companion-warm': { volcengineVoiceType: 'zh_female_warm_real_token' },
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('voice-id-mapping', () => {
  it('covers EVERY platform voice id (continuity: profile never blocked by a vendor gap)', () => {
    for (const voiceId of PLATFORM_VOICE_IDS) {
      expect(VOICE_MAPPING[voiceId].volcengineVoiceType.length).toBeGreaterThan(0)
    }
  })

  it('resolves a filled mapping to its vendor voice params', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(resolveVendorVoice('companion-warm', FILLED)).toEqual({
      volcengineVoiceType: 'zh_female_warm_real_token',
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it('degrades an unmapped voice id to undefined with a warning — never throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(resolveVendorVoice('vendor-raw-token')).toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no vendor mapping'))
  })

  it('degrades an unfilled PLACEHOLDER_* token to undefined with a warning — never throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // The committed mapping is all placeholders until deploy back-fill.
    expect(resolveVendorVoice('companion-warm')).toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unfilled placeholder'))
  })
})
