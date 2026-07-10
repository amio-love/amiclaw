import type { Direction } from '../engine/types'

export function MoveControls({ onMove }: { onMove(direction: Direction): void }) {
  return (
    <div className="direction-pad" aria-label="Movement controls">
      <button type="button" className="up" aria-label="Move up" onClick={() => onMove('up')}>
        ↑
      </button>
      <button type="button" className="left" aria-label="Move left" onClick={() => onMove('left')}>
        ←
      </button>
      <button type="button" className="down" aria-label="Move down" onClick={() => onMove('down')}>
        ↓
      </button>
      <button
        type="button"
        className="right"
        aria-label="Move right"
        onClick={() => onMove('right')}
      >
        →
      </button>
    </div>
  )
}
