import { IconButton } from '@amiclaw/ui'

import type { Direction } from '../engine/types'

export function MoveControls({ onMove }: { onMove(direction: Direction): void }) {
  return (
    <div className="direction-pad" aria-label="移动控制">
      <IconButton className="up" variant="bare" label="向上移动" onClick={() => onMove('up')}>
        ↑
      </IconButton>
      <IconButton className="left" variant="bare" label="向左移动" onClick={() => onMove('left')}>
        ←
      </IconButton>
      <IconButton className="down" variant="bare" label="向下移动" onClick={() => onMove('down')}>
        ↓
      </IconButton>
      <IconButton className="right" variant="bare" label="向右移动" onClick={() => onMove('right')}>
        →
      </IconButton>
    </div>
  )
}
