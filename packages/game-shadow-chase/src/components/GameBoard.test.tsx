import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { createRunningState } from '../engine/rules'
import { GameBoard } from './GameBoard'

describe('whole-board target ownership', () => {
  it('commits a target when the pointer starts over a visual overlay', () => {
    const onTarget = vi.fn()
    render(<GameBoard state={createRunningState('courtyard', 'standard', 7)} onTarget={onTarget} />)
    const board = screen.getByRole('application', { name: '双影追逃地图' })
    Object.defineProperty(board, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 336, height: 336 }),
    })
    Object.defineProperty(board, 'setPointerCapture', { value: vi.fn() })
    const core = screen.getByLabelText('光核 1')
    fireEvent.pointerDown(core, { pointerId: 1, clientX: 312, clientY: 24 })
    fireEvent.pointerUp(core, { pointerId: 1, clientX: 312, clientY: 24 })
    expect(onTarget).toHaveBeenCalledWith({ x: 6, y: 0 })
  })

  it('does not commit movement while the board is frozen for planning', () => {
    const onTarget = vi.fn()
    render(
      <GameBoard
        state={createRunningState('courtyard', 'standard', 7)}
        interactive={false}
        onTarget={onTarget}
      />
    )
    const board = screen.getByRole('application', { name: '双影追逃地图' })
    fireEvent.pointerDown(board, { pointerId: 1, clientX: 24, clientY: 24 })
    fireEvent.pointerUp(board, { pointerId: 1, clientX: 24, clientY: 24 })
    expect(onTarget).not.toHaveBeenCalled()
  })
})
