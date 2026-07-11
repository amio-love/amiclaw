import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { advance } from '../engine/reducer'
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

  it('renders non-intercepting sight lanes and a visible current target indicator', () => {
    const state = createRunningState('courtyard', 'standard', 7)
    state.tick = 1
    state.actors.pursuer.position = { x: 0, y: 0 }
    state.actors.pursuer.target = 'player'
    state.actors.pursuer.destination = 'player'
    const onTarget = vi.fn()
    const view = render(<GameBoard state={state} onTarget={onTarget} />)

    const lanes = document.querySelectorAll('.sight-lane.board-overlay')
    expect(lanes).toHaveLength(4)
    expect(document.querySelector('[data-direction="up"]')?.getAttribute('y2')).toBe('24')
    expect(document.querySelector('[data-direction="right"]')?.getAttribute('x2')).toBe('312')
    const target = document.querySelector('.pursuer-destination-indicator')!
    expect(document.querySelectorAll('.pursuer-destination-indicator')).toHaveLength(1)
    expect(target.classList.contains('board-overlay')).toBe(true)
    expect(target.getAttribute('aria-hidden')).toBe('true')
    const board = screen.getByRole('application', { name: '双影追逃地图' })
    const description = document.getElementById(board.getAttribute('aria-describedby')!)
    expect(description?.textContent).toBe('追兵当前目标：你')
    Object.defineProperty(board, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 336, height: 336 }),
    })
    fireEvent.pointerDown(target, { pointerId: 2, clientX: 120, clientY: 72 })
    fireEvent.pointerUp(target, { pointerId: 2, clientX: 120, clientY: 72 })
    expect(onTarget).toHaveBeenCalledWith({ x: 2, y: 1 })

    state.actors.pursuer.destination = 'moon-gate'
    view.rerender(<GameBoard state={state} onTarget={onTarget} />)
    expect(document.querySelectorAll('.pursuer-destination-indicator')).toHaveLength(1)
    expect(description?.textContent).toBe('追兵当前目标：月门')
  })

  it('derives a truthful planning destination before the first policy tick', () => {
    const state = createRunningState('crossroads', 'standard', 7)
    state.actors.pursuer.position = { x: 4, y: 0 }
    state.actors.player.position = { x: 2, y: 0 }
    state.actors.companion.position = { x: 1, y: 2 }
    state.actors.pursuer.destination = 'moon-gate'

    render(<GameBoard state={state} interactive={false} onTarget={vi.fn()} />)

    const board = screen.getByRole('application', { name: '双影追逃地图' })
    const description = document.getElementById(board.getAttribute('aria-describedby')!)
    expect(description?.textContent).toBe('追兵当前目标：你')
  })

  it('describes the reconciled destination immediately after capture', () => {
    const state = createRunningState('courtyard', 'intense', 7)
    state.actors.pursuer.position = { x: 2, y: 1 }
    state.actors.player.position = { x: 1, y: 1 }
    state.actors.companion.position = { x: 6, y: 6 }
    const contacted = advance(state, [])

    render(<GameBoard state={contacted} onTarget={vi.fn()} />)

    const board = screen.getByRole('application', { name: '双影追逃地图' })
    const description = document.getElementById(board.getAttribute('aria-describedby')!)
    expect(description?.textContent).toBe('追兵当前目标：月门')
  })
})
