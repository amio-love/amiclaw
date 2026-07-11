import styles from './VerbCards.module.css'
import { CARE_VERBS } from '@/game/care-verbs'

interface VerbCardsProps {
  disabled: boolean
  onVerb: (actionType: string) => void
}

/* Five care verb cards (浇水/遮光/施肥/换盆/催花). Select a pot, tap a verb →
   the engine action. Disabled until a live plant is selected. Min 44px tap
   targets for mobile. */
export default function VerbCards({ disabled, onVerb }: VerbCardsProps) {
  return (
    <div className={styles.verbs} role="group" aria-label="养护动作">
      {CARE_VERBS.map((verb) => (
        <button
          key={verb.actionType}
          type="button"
          className={styles.verb}
          disabled={disabled}
          onClick={() => onVerb(verb.actionType)}
        >
          {verb.label}
        </button>
      ))}
    </div>
  )
}
