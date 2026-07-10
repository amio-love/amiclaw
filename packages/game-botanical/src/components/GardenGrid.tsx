import styles from './GardenGrid.module.css'
import PotCell from './PotCell'
import type { PlantView, ZoneView } from '@/game/useGardenSession'
import { LIGHT_LABEL, ZONE_LABEL } from '@/game/visual-map'

interface GardenGridProps {
  plants: PlantView[]
  zones: ZoneView[]
  selectedId: string | null
  onSelect: (elementId: string) => void
}

/* The 3×3 pot grid, drawn as three stacked zone bands (北/中/南). Each band is
   tinted by its ambient light level and labels the light so the gardener can
   describe what they see; pots sit at their covered positions. */
export default function GardenGrid({ plants, zones, selectedId, onSelect }: GardenGridProps) {
  const plantByPosition = new Map(plants.map((p) => [p.potPosition, p]))
  const orderedZones = [...zones].sort((a, b) => (a.positions[0] ?? 0) - (b.positions[0] ?? 0))

  return (
    <div className={styles.board} role="group" aria-label="植物园">
      {orderedZones.map((zone) => (
        <section key={zone.id} className={styles.zone} data-light={zone.lightLevel}>
          <header className={styles.zoneLabel}>
            <i className={styles.dot} />
            {ZONE_LABEL[zone.zoneId] ?? zone.zoneId} · 光照
            {LIGHT_LABEL[zone.lightLevel] ?? zone.lightLevel}
          </header>
          <div className={styles.row}>
            {zone.positions.map((position) => (
              <PotCell
                key={position}
                position={position}
                plant={plantByPosition.get(position) ?? null}
                selected={plantByPosition.get(position)?.id === selectedId}
                onSelect={onSelect}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
