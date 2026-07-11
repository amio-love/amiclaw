import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { GamePage } from './GamePage'

// GamePage reads ?level= via useSearchParams, so it must render under a router.
function renderGame() {
  return render(
    <MemoryRouter>
      <GamePage />
    </MemoryRouter>
  )
}

// Mock the wall-clock loop so decay is driven deterministically from the test
// (frozen time — no real-time waits). The mock captures the latest onTick while
// the run is active, mirroring the real freeze (active=false → no ticks).
const hoisted = vi.hoisted(() => ({ tick: { current: null as ((dt: number) => void) | null } }))
vi.mock('@/hooks/useDecayLoop', () => ({
  useDecayLoop: (onTick: (dt: number) => void, active: boolean) => {
    hoisted.tick.current = active ? onTick : null
  },
}))

function step(dtMs: number) {
  act(() => {
    hoisted.tick.current?.(dtMs)
  })
}

function pot(nameFragment: RegExp) {
  return screen.getByRole('button', { name: nameFragment })
}

describe('GamePage', () => {
  beforeEach(() => {
    hoisted.tick.current = null
  })

  it('renders the garden scene and verb cards', () => {
    renderGame()
    expect(screen.getByRole('timer')).toHaveTextContent('00:00')
    expect(screen.getByRole('button', { name: '浇水' })).toBeInTheDocument()
    expect(pot(/蕨类/)).toBeInTheDocument()
    expect(pot(/兰花/)).toBeInTheDocument()
  })

  it('select → verb → state change heals the plant', () => {
    renderGame()
    expect(pot(/蕨类/)).toHaveAccessibleName(/枯萎/)

    fireEvent.click(pot(/蕨类/)) // select fern
    fireEvent.click(screen.getByRole('button', { name: '浇水' })) // water

    expect(pot(/蕨类/)).toHaveAccessibleName(/稳定/)
    expect(screen.getByRole('status')).toHaveTextContent(/好转/)
  })

  it('prompts to pick a plant when a verb is tapped with no selection', () => {
    renderGame()
    fireEvent.click(screen.getByRole('button', { name: '浇水' }))
    expect(screen.getByRole('status')).toHaveTextContent('请先选择一株植株')
  })

  it('shows the win overlay after the tutorial care path', () => {
    renderGame()
    fireEvent.click(pot(/蕨类/))
    fireEvent.click(screen.getByRole('button', { name: '浇水' }))
    fireEvent.click(pot(/兰花/))
    fireEvent.click(screen.getByRole('button', { name: '遮光' }))
    fireEvent.click(screen.getByRole('button', { name: '施肥' }))
    fireEvent.click(screen.getByRole('button', { name: '换盆' }))
    fireEvent.click(screen.getByRole('button', { name: '催花' }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/养护成功/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: '再玩一次' })).toBeInTheDocument()
  })

  it('shows the lose overlay when a plant decays to death', () => {
    renderGame()
    step(20000) // orchid: wilting → critical
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    step(60000) // orchid: critical → dead → lost

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/养护失败/)).toBeInTheDocument()
  })

  it('switches levels via the picker (data-driven from the fixtures)', () => {
    renderGame()
    // The tutorial (bg-demo-001) has no moss; the standard level (bg-standard-001) does.
    expect(screen.queryByRole('button', { name: /苔藓/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '温室轮值' }))
    expect(screen.getByRole('button', { name: /苔藓/ })).toBeInTheDocument()
  })

  it('re-playing fully resets the run', () => {
    renderGame()
    // Win quickly.
    fireEvent.click(pot(/蕨类/))
    fireEvent.click(screen.getByRole('button', { name: '浇水' }))
    fireEvent.click(pot(/兰花/))
    fireEvent.click(screen.getByRole('button', { name: '遮光' }))
    fireEvent.click(screen.getByRole('button', { name: '施肥' }))
    fireEvent.click(screen.getByRole('button', { name: '换盆' }))
    fireEvent.click(screen.getByRole('button', { name: '催花' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '再玩一次' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('timer')).toHaveTextContent('00:00')
    // fern is back to its wilting start state
    expect(pot(/蕨类/)).toHaveAccessibleName(/枯萎/)
  })
})
