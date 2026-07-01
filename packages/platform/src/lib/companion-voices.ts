import type { PlatformVoiceId } from '@shared/companion-types'
import { PLATFORM_VOICE_IDS } from '@shared/companion-types'

/**
 * Player-facing presentation for each platform-neutral voice id.
 *
 * The onboarding voice picker has NO real-time audition: the platform SPA does
 * not (yet) have a wired TTS preview, and fabricating audio playback that does
 * not exist would be dishonest. So each voice is represented by a short Chinese
 * name + a one-line character description and a decorative accent colour — the
 * player chooses by reading, not listening. If a real audition mechanism lands
 * later, it attaches to these same ids.
 *
 * `accent` is drawn from existing design-system decorative channels (brand
 * yellow + the two decorative accent tokens) — no new hues.
 */
export interface VoicePresentation {
  id: PlatformVoiceId
  /** One-character glyph shown in the option's avatar. */
  glyph: string
  /** Short display name. */
  name: string
  /** One-line character description — what this voice feels like. */
  description: string
  /** Decorative accent (an existing token var name) for the option avatar ring. */
  accent: string
}

export const VOICE_PRESENTATIONS: Record<PlatformVoiceId, VoicePresentation> = {
  'companion-warm': {
    id: 'companion-warm',
    glyph: '暖',
    name: '暖声',
    description: '温厚沉稳，像深夜电台里陪着你的声音。',
    accent: 'var(--amio-yellow)',
  },
  'companion-bright': {
    id: 'companion-bright',
    glyph: '亮',
    name: '亮声',
    description: '清亮轻快，话语里总带着一点笑意。',
    accent: 'var(--accent-blue)',
  },
  'companion-calm': {
    id: 'companion-calm',
    glyph: '静',
    name: '静声',
    description: '平静专注，慢条斯理，关键时刻很稳。',
    accent: 'var(--accent-violet)',
  },
}

/** The three voices in catalog order, for rendering the picker. */
export const VOICE_OPTIONS: VoicePresentation[] = PLATFORM_VOICE_IDS.map(
  (id) => VOICE_PRESENTATIONS[id]
)

/** Display name for a stored voice id; falls back to the raw id if unknown. */
export function voiceName(voiceId: string): string {
  return (
    (VOICE_PRESENTATIONS as Record<string, VoicePresentation | undefined>)[voiceId]?.name ?? voiceId
  )
}
