/**
 * Full game flow integration test.
 * Mocks: module components (trivially completable), leaderboard API.
 * Tests: home → practice game → START → 4 module completions → result page (DEFUSED).
 *
 * Uses real timers.  Each module has a unique testid so the loop waits for the
 * correct module to be mounted before clicking — this prevents accidentally
 * clicking the previous module's button while the MODULE_COMPLETE overlay is
 * still visible (800 ms auto-advance).
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi, describe, it, expect } from 'vitest'
import App from './App'

vi.mock('./modules/wire/WireModule', () => ({
  default: ({ onComplete }: { onComplete: () => void }) => (
    <button data-testid="mock-wire-complete" onClick={onComplete}>
      complete-wire
    </button>
  ),
}))
vi.mock('./modules/dial/DialModule', () => ({
  default: ({ onComplete }: { onComplete: () => void }) => (
    <button data-testid="mock-dial-complete" onClick={onComplete}>
      complete-dial
    </button>
  ),
}))
vi.mock('./modules/button/ButtonModule', () => ({
  default: ({ onComplete }: { onComplete: () => void }) => (
    <button data-testid="mock-button-complete" onClick={onComplete}>
      complete-button
    </button>
  ),
}))
vi.mock('./modules/keypad/KeypadModule', () => ({
  default: ({ onComplete }: { onComplete: () => void }) => (
    <button data-testid="mock-keypad-complete" onClick={onComplete}>
      complete-keypad
    </button>
  ),
}))

vi.mock('./utils/leaderboard-api', () => ({
  submitScore: vi.fn().mockResolvedValue({ rank: 5, total_players: 100 }),
  fetchLeaderboard: vi.fn().mockResolvedValue({ date: '2026-03-16', entries: [] }),
}))

const MODULE_TESTIDS = [
  'mock-wire-complete',
  'mock-dial-complete',
  'mock-button-complete',
  'mock-keypad-complete',
]

describe('full game flow: home → practice → result', () => {
  it('navigates through the full practice run and shows DEFUSED on result page', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    )

    // Home page
    expect(screen.getByText('BOMBSQUAD')).toBeInTheDocument()

    // Clicking 练习 opens the prompt modal first; confirming inside the
    // modal is what actually navigates into the game.
    fireEvent.click(screen.getByRole('button', { name: /^练习$/ }))
    fireEvent.click(screen.getByRole('button', { name: /^确认开始游戏$/ }))

    // Practice manual is inlined via ?raw — wait for the async load() microtask to complete
    await waitFor(() => expect(screen.getByText('准备好了吗？')).toBeInTheDocument())

    // Start the game
    fireEvent.click(screen.getByRole('button', { name: /^开始$/ }))

    // Complete all 4 modules.
    // Each module has a unique testid so we wait for the correct one to mount
    // before clicking — avoids re-clicking the same button during the 800 ms
    // MODULE_COMPLETE overlay.
    for (const testId of MODULE_TESTIDS) {
      await waitFor(() => expect(screen.getByTestId(testId)).toBeInTheDocument(), { timeout: 3000 })
      fireEvent.click(screen.getByTestId(testId))
    }

    // After the 4th module: MODULE_COMPLETE → (800 ms) → NEXT_MODULE → ALL_COMPLETE
    // → ALL_MODULES_COMPLETE → RESULT → navigate('/result') → ResultPage renders.
    await waitFor(
      () => expect(screen.getByRole('heading', { name: /拆弹成功/ })).toBeInTheDocument(),
      { timeout: 5000 }
    )
  }, 12000)
})
