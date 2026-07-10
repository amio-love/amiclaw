import styles from './PotCell.module.css'
import DecayRing, { type DecayTone } from './DecayRing'
import PlantSprite from './PlantSprite'
import type { PlantView } from '@/game/useGardenSession'
import { GROWTH_LABEL, HEALTH_LABEL, LIGHT_LABEL, speciesLabel } from '@/game/visual-map'

interface PotCellProps {
  position: number
  plant: PlantView | null
  selected: boolean
  onSelect: (elementId: string) => void
}

function decayTone(plant: PlantView): DecayTone {
  if (plant.health === 'critical') return 'critical'
  if (plant.decayWarning) return 'warning'
  return 'ok'
}

/* One 3×3 grid cell. Occupied → a tappable pot (min 44px) carrying the plant
   sprite, decay ring, and a species/health/growth label; empty → a dashed
   placeholder. The accessible name is the full plant state so voice/AT and
   RTL tests can read it. */
export default function PotCell({ position, plant, selected, onSelect }: PotCellProps) {
  if (plant === null) {
    return (
      <div className={`${styles.pot} ${styles.empty}`} aria-hidden="true">
        空盆
      </div>
    )
  }

  const isDead = plant.health === 'dead'
  const label = isDead
    ? `${speciesLabel(plant.species)} · 枯株`
    : `${speciesLabel(plant.species)} · ${HEALTH_LABEL[plant.health]} · ${GROWTH_LABEL[plant.growthStage]} · 实际光照${LIGHT_LABEL[plant.effectiveLight]}`

  const classes = [
    styles.pot,
    styles[`h_${plant.health}`],
    selected ? styles.selected : '',
    plant.growthStage === 'flowering' ? styles.flowering : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      type="button"
      className={classes}
      data-decay={isDead ? 'dead' : decayTone(plant)}
      data-position={position}
      aria-pressed={selected}
      aria-label={label}
      disabled={isDead}
      onClick={() => onSelect(plant.id)}
    >
      {!isDead && <DecayRing fraction={plant.decayFraction} tone={decayTone(plant)} />}
      {plant.growthStage === 'flowering' && <span className={styles.bloom}>✿</span>}
      <PlantSprite species={plant.species} health={plant.health} growthStage={plant.growthStage} />
      <span className={styles.speciesLabel}>{speciesLabel(plant.species)}</span>
      <span className={styles.chips}>
        {isDead ? '枯株' : `${HEALTH_LABEL[plant.health]} · ${GROWTH_LABEL[plant.growthStage]}`}
      </span>
    </button>
  )
}
