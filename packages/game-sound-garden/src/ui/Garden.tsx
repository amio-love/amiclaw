/**
 * The garden timeline — two lanes (melody flowers on top, rhythm roots below)
 * across N slots, horizontally scrollable inside its own container. The
 * player's lane is interactive; tapping the partner's lane just explains it.
 * Per-pair relation feedback is shown via the column's relation class once both
 * lanes fill a slot — the full matrix is never rendered (协作发现).
 */

import { PIECE_META } from '../game/constants'
import type { MelodyType, RhythmType } from '../game/constants'
import type { Archetype, RelationName } from '../game/types'

interface GardenProps {
  slots: number
  melody: (MelodyType | null)[]
  rhythm: (RhythmType | null)[]
  relations: (RelationName | null)[]
  activeStep: number
  playerArchetype: Archetype
  onSlotTap: (slot: number) => void
  onPartnerHint: () => void
}

export function Garden(props: GardenProps) {
  const { slots, melody, rhythm, relations, activeStep, playerArchetype } = props
  const columns = []
  for (let i = 0; i < slots; i++) {
    const m = melody[i]
    const r = rhythm[i]
    const rel = relations[i]
    const colClass = ['sg-col', activeStep === i ? 'active' : '', rel ? `rel-${rel}` : '']
      .filter(Boolean)
      .join(' ')

    const melodyOwned = playerArchetype === 'melody_piece'
    const rhythmOwned = playerArchetype === 'rhythm_piece'

    columns.push(
      <div className={colClass} key={i}>
        <button
          type="button"
          className={`sg-cell melody ${m ? 'filled' : 'empty'} ${melodyOwned ? 'owned' : 'partner'}`}
          aria-label={melodyOwned ? `旋律 第${i + 1}拍` : `伙伴旋律 第${i + 1}拍`}
          onClick={() => (melodyOwned ? props.onSlotTap(i + 1) : props.onPartnerHint())}
        >
          {m ? (
            <>
              <span className="pemoji">{PIECE_META[m].emoji}</span>
              <span className="plabel">{PIECE_META[m].label}</span>
            </>
          ) : (
            <span className="planticon">{melodyOwned ? '🌱' : '·'}</span>
          )}
        </button>
        <button
          type="button"
          className={`sg-cell rhythm ${r ? 'filled' : 'empty'} ${rhythmOwned ? 'owned' : 'partner'}`}
          aria-label={rhythmOwned ? `节奏 第${i + 1}拍` : `伙伴节奏 第${i + 1}拍`}
          onClick={() => (rhythmOwned ? props.onSlotTap(i + 1) : props.onPartnerHint())}
        >
          {r ? (
            <>
              <span className="pemoji">{PIECE_META[r].emoji}</span>
              <span className="plabel">{PIECE_META[r].label}</span>
            </>
          ) : (
            <span className="planticon">{rhythmOwned ? '🌱' : '·'}</span>
          )}
        </button>
        <div className="sg-beat">{i + 1}</div>
      </div>
    )
  }

  return <div className="sg-garden">{columns}</div>
}
