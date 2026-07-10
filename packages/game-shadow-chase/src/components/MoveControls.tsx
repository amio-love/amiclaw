import type { Direction } from '../engine/types'

export function MoveControls({ onMove }: { onMove(direction: Direction): void }) {
  return (
    <div className="direction-pad" aria-label="移动控制">
      <button type="button" className="up" aria-label="向上移动" onClick={() => onMove('up')}>
        ↑
      </button>
      <button type="button" className="left" aria-label="向左移动" onClick={() => onMove('left')}>
        ←
      </button>
      <button type="button" className="down" aria-label="向下移动" onClick={() => onMove('down')}>
        ↓
      </button>
      <button type="button" className="right" aria-label="向右移动" onClick={() => onMove('right')}>
        →
      </button>
    </div>
  )
}
