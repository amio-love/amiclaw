import styles from './DecayRing.module.css'

export type DecayTone = 'ok' | 'warning' | 'critical'

interface DecayRingProps {
  /** 0 → just ticked, 1 → tick due. */
  fraction: number
  tone: DecayTone
}

/* Per-plant decay countdown as a donut ring filling toward the next neglect
   tick. Green while safe, amber inside the warning window, red once the plant
   is critical — the spike proved this materially sharpens triage feel.
   Purely decorative (the pot button carries the accessible label). */
export default function DecayRing({ fraction, tone }: DecayRingProps) {
  return (
    <div
      className={styles.ring}
      data-tone={tone}
      style={{ ['--frac' as string]: String(Math.max(0, Math.min(1, fraction))) }}
      aria-hidden="true"
    />
  )
}
