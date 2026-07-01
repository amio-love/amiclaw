import styles from './Toggle.module.css'

interface ToggleProps {
  /** Controlled on/off state. */
  checked: boolean
  /** Called with the next state when the player flips the switch. */
  onChange: (next: boolean) => void
  /** Accessible name — required (the switch carries no visible label text). */
  label: string
  disabled?: boolean
  className?: string
}

/* A controlled on/off switch (role="switch"). The knob slides on a glass track;
   the whole control is ≥44px tall so the tap target meets the design-system
   minimum. CSS-only motion — the track + knob transitions degrade to none under
   prefers-reduced-motion (see Toggle.module.css). */
export default function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
  className,
}: ToggleProps) {
  const classes = [styles.toggle, checked && styles.on, className].filter(Boolean).join(' ')
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={classes}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.track} aria-hidden="true">
        <span className={styles.knob} />
      </span>
    </button>
  )
}
