import styles from './PlantSprite.module.css'
import { plantSprite } from '@/game/visual-map'

interface PlantSpriteProps {
  species: string
  health: string
  growthStage: string
}

/* The plant glyph. Health drives tint + wilt tilt (CSS classes), growth drives
   size, and flowering / death swap the glyph. All motion is CSS-only and
   gated behind prefers-reduced-motion. aria-hidden — the pot button owns the
   accessible name. */
export default function PlantSprite({ species, health, growthStage }: PlantSpriteProps) {
  const glyph = plantSprite(species, health, growthStage)
  const classes = [
    styles.sprite,
    styles[`h_${health}`],
    styles[`g_${growthStage}`],
    growthStage === 'flowering' ? styles.flowering : '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <span className={classes} aria-hidden="true">
      {glyph}
    </span>
  )
}
