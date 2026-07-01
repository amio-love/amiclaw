import type { PlatformVoiceId } from '@shared/companion-types'
import { VOICE_OPTIONS } from '@/lib/companion-voices'
import styles from './VoicePicker.module.css'

interface VoicePickerProps {
  value: PlatformVoiceId | null
  onChange: (voiceId: PlatformVoiceId) => void
}

/* The onboarding voice picker — a radio group of three platform voices. There
   is no real-time audition (no wired TTS preview), so each voice is chosen by
   its name + character description, never by fabricated audio playback. Each
   option is a ≥44px-tall radio button; the group is keyboard- and
   screen-reader-navigable. */
export default function VoicePicker({ value, onChange }: VoicePickerProps) {
  return (
    <div className={styles.group} role="radiogroup" aria-label="选择音色">
      {VOICE_OPTIONS.map((voice) => {
        const selected = value === voice.id
        return (
          <button
            key={voice.id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={voice.name}
            className={[styles.option, selected && styles.selected].filter(Boolean).join(' ')}
            onClick={() => onChange(voice.id)}
          >
            <span className={styles.glyph} style={{ color: voice.accent }} aria-hidden="true">
              {voice.glyph}
            </span>
            <span className={styles.meta}>
              <span className={styles.name}>{voice.name}</span>
              <span className={styles.description}>{voice.description}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
