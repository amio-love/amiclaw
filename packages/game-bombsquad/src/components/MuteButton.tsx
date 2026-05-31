import { useMuted, toggleMuted } from '@/audio/mute'

interface MuteButtonProps {
  /** Style class supplied by the host page (see GamePage.module.css `.muteBtn`). */
  className?: string
}

/**
 * Icon-only toggle for the global SFX mute. Reflects and drives the shared
 * mute store, so its state stays correct across refresh / re-entry. Renders a
 * speaker glyph — with sound waves when audible, with a cross when muted —
 * and exposes the state to assistive tech via `aria-pressed`.
 */
export default function MuteButton({ className }: MuteButtonProps) {
  const muted = useMuted()
  const label = muted ? '取消静音' : '静音'
  return (
    <button
      type="button"
      className={className}
      onClick={() => toggleMuted()}
      aria-label={label}
      aria-pressed={muted}
      title={label}
    >
      <svg
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none" />
        {muted ? (
          <>
            <path d="M17 9l5 6" />
            <path d="M22 9l-5 6" />
          </>
        ) : (
          <>
            <path d="M16.5 8.5a5 5 0 0 1 0 7" />
            <path d="M19.5 6a9 9 0 0 1 0 12" />
          </>
        )}
      </svg>
    </button>
  )
}
