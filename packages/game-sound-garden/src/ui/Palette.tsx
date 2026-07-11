/**
 * The player's piece palette — one chip per pool type with its remaining count.
 * Tap a chip to select it (and preview-listen), then tap an empty slot to
 * plant. A depleted type dims out. The 🔊 button previews without selecting.
 */

import { PIECE_META } from '../game/constants'
import type { PieceType } from '../game/constants'

interface PaletteProps {
  palette: { type: PieceType; remaining: number }[]
  selected: PieceType | null
  onSelect: (type: PieceType) => void
  onPreview: (type: PieceType) => void
}

export function Palette(props: PaletteProps) {
  return (
    <section className="sg-palette">
      {props.palette.map(({ type, remaining }) => {
        const depleted = remaining <= 0
        const cls = [
          'sg-chip',
          props.selected === type ? 'selected' : '',
          depleted ? 'depleted' : '',
        ]
          .filter(Boolean)
          .join(' ')
        return (
          <div className={cls} key={type}>
            <button
              type="button"
              className="sg-chip-main"
              disabled={depleted}
              aria-label={`选择${PIECE_META[type].label}，剩余 ${remaining}`}
              onClick={() => props.onSelect(type)}
            >
              <span className="cemoji">{PIECE_META[type].emoji}</span>
              <span className="clabel">{PIECE_META[type].label}</span>
              <span className="ccount">×{remaining}</span>
            </button>
            <button
              type="button"
              className="clisten"
              aria-label={`试听${PIECE_META[type].label}`}
              onClick={() => props.onPreview(type)}
            >
              🔊
            </button>
          </div>
        )
      })}
    </section>
  )
}
