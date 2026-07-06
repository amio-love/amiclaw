/**
 * @vitest-environment jsdom
 *
 * Minimal component tests per the sibling testing-library convention: the
 * active role tab renders exactly that role's filtered view (no cannot_see
 * leakage in the DOM), one action interaction advances session state, and
 * the game selector switches into the co_build shell (score bar, shared
 * timeline for both builder roles).
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadGameType, loadLevel } from '../src/schema/load'
import type { GameOption } from './App'
import { App } from './App'
import { DevShellStore } from './store'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')
const radioGameType = loadGameType(
  readFileSync(join(fixtures, 'radio-cipher', 'game-type.yaml'), 'utf8')
)
const radioLevel = loadLevel(
  readFileSync(join(fixtures, 'radio-cipher', 'level.rc-demo-001.yaml'), 'utf8')
)
const gardenGameType = loadGameType(
  readFileSync(join(fixtures, 'sound-garden', 'game-type.yaml'), 'utf8')
)
const gardenLevel = loadLevel(
  readFileSync(join(fixtures, 'sound-garden', 'level.sg-demo-001.yaml'), 'utf8')
)

let radioStore: DevShellStore
let gardenStore: DevShellStore

function makeGames(): GameOption[] {
  radioStore = new DevShellStore(radioGameType, radioLevel)
  gardenStore = new DevShellStore(gardenGameType, gardenLevel)
  return [
    { id: 'radio-cipher', label: 'Radio Cipher (hidden_info_coop)', create: () => radioStore },
    { id: 'sound-garden', label: 'Sound Garden (co_build)', create: () => gardenStore },
  ]
}

describe('dev shell App', () => {
  it('renders the listener tab without any cannot_see field in the DOM', () => {
    const { container } = render(<App games={makeGames()} />)
    // Listener view: segments visible, hidden fields and decoder-only
    // elements absent.
    expect(screen.getByLabelText('listener view')).toBeTruthy()
    expect(container.textContent).toContain('seg-1')
    expect(container.textContent).toContain('content_length')
    expect(container.textContent).not.toContain('plaintext_category')
    expect(container.textContent).not.toContain('key-1')
    expect(container.textContent).not.toContain('shift_amount')
  })

  it('advances session state when an action is performed', () => {
    render(<App games={makeGames()} />)
    const actionSelect = screen.getByLabelText('Action') as HTMLSelectElement
    fireEvent.change(actionSelect, { target: { value: 'execute_decryption' } })
    fireEvent.click(screen.getByText('Perform'))
    // seg-1 advanced encrypted → partial; the log records the rule firing.
    expect(radioStore.stateOf('seg-1').decryption_progress).toBe('partial')
    expect(screen.getByText(/rule-decrypt-1/)).toBeTruthy()
    expect(screen.getAllByText(/partial/).length).toBeGreaterThan(0)
  })

  it('shows both role views only when the spoiler toggle is on', () => {
    render(<App games={makeGames()} />)
    expect(screen.queryByLabelText('decoder view')).toBeNull()
    fireEvent.click(screen.getByLabelText(/Self-play spoiler/))
    expect(screen.getByLabelText('listener view')).toBeTruthy()
    expect(screen.getByLabelText('decoder view')).toBeTruthy()
  })

  it('switches to the sound-garden co_build shell with a score bar and shared timeline', () => {
    const { container } = render(<App games={makeGames()} />)
    fireEvent.change(screen.getByLabelText('Game'), { target: { value: 'sound-garden' } })
    expect(container.textContent).toContain('声音花园')
    expect(screen.getByText(/Score: 0 \/ target 10/)).toBeTruthy()
    // Symmetric partition: the rhythm builder's tab shows BOTH piece kinds.
    expect(screen.getByLabelText('rhythm_builder view')).toBeTruthy()
    expect(container.textContent).toContain('r1')
    expect(container.textContent).toContain('m1')
    expect(container.textContent).toContain('unplaced')
  })

  it('placing pieces through the UI raises the score', () => {
    render(<App games={makeGames()} />)
    fireEvent.change(screen.getByLabelText('Game'), { target: { value: 'sound-garden' } })
    // rhythm_builder places r1 (default action place_piece, default target r1).
    fireEvent.click(screen.getByText('Perform'))
    expect(gardenStore.placementOf('r1')).toBe('placed')
    // Switch to the melody builder tab and place m1 → first pair scores 3.
    fireEvent.click(screen.getByText(/旋律手/))
    const targetSelect = screen.getByLabelText('Target element') as HTMLSelectElement
    fireEvent.change(targetSelect, { target: { value: 'm1' } })
    fireEvent.click(screen.getByText('Perform'))
    expect(gardenStore.score()?.current).toBe(3)
    expect(screen.getByText(/Score: 3 \/ target 10/)).toBeTruthy()
  })

  it('F6: the target dropdown only offers archetypes the acting role can target', () => {
    makeGames()
    // melody_builder.target_archetypes = [melody_piece]: only melody pieces,
    // no rhythm pieces (which it would see under symmetric co_build visibility).
    const melodyTargets = gardenStore.targetableElements('melody_builder').map((e) => e.element_id)
    expect(melodyTargets).toEqual(['m1', 'm2', 'm3', 'm4'])
    expect(melodyTargets).not.toContain('r1')
    const rhythmTargets = gardenStore.targetableElements('rhythm_builder').map((e) => e.element_id)
    expect(rhythmTargets).toEqual(['r1', 'r2', 'r3', 'r4'])
    expect(rhythmTargets).not.toContain('m1')
  })
})
