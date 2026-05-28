/**
 * Full game flow integration tests.
 * Mocks: module components (trivially completable), leaderboard API, the
 * daily manual loader (so the daily run resolves a manual without a network).
 *
 * Covers two runs:
 *   1. practice → START → 2 module completions → result page (拆弹成功)
 *   2. daily    → START → 4 module completions → result page (拆弹成功)
 *
 * Practice runs a reduced 2-module sequence (wire + keypad); daily runs the
 * full 4 (wire + dial + button + keypad). Each module has a unique testid so
 * the loop waits for the correct module to be mounted before clicking — this
 * prevents accidentally clicking the previous module's button while the
 * MODULE_COMPLETE overlay is still visible (800 ms auto-advance).
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import yaml from 'js-yaml'
import type { Manual } from '@shared/manual-schema'
import App from './App'
import practiceYamlRaw from '../../manual/data/practice.yaml?raw'

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

// Daily mode loads its manual over the network. Mock the loader to resolve
// the practice manual (it carries all four module rule sections), so a daily
// run can be exercised end to end without a real fetch. Keep the typed error
// classes real — GamePage's loadWithCache uses them for `instanceof` checks.
vi.mock('./utils/yaml-loader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./utils/yaml-loader')>()
  return { ...actual, loadManual: vi.fn() }
})

import { loadManual } from './utils/yaml-loader'

const PRACTICE_MODULE_TESTIDS = ['mock-wire-complete', 'mock-keypad-complete']
const DAILY_MODULE_TESTIDS = [
  'mock-wire-complete',
  'mock-dial-complete',
  'mock-button-complete',
  'mock-keypad-complete',
]

async function completeModules(testIds: string[]) {
  for (const testId of testIds) {
    await waitFor(() => expect(screen.getByTestId(testId)).toBeInTheDocument(), { timeout: 3000 })
    fireEvent.click(screen.getByTestId(testId))
  }
}

describe('full game flow', () => {
  // Each test drives a full run to RESULT, which persists into sessionStorage;
  // clear it so the next test's GameProvider hydrates from a clean slate.
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('practice run: 2 modules → result page shows 拆弹成功', async () => {
    // Enter directly at the practice run route (/bombsquad/run) —
    // symmetric with the daily test below. This deliberately skips the
    // landing → connect screens; the homepage CTA → landing → connect →
    // run path is covered separately by GamesPage.test.tsx and the
    // screen tests.
    render(
      <MemoryRouter initialEntries={['/bombsquad/run?mode=practice']}>
        <App />
      </MemoryRouter>
    )

    // Practice manual is inlined via ?raw — wait for the standard ready
    // prompt to render, then start the run. Both modes show the same
    // "ready?" screen; the game page never onboards the player.
    await waitFor(() => expect(screen.getByText('准备好了吗？')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /^开始$/ }))

    // Practice runs only the reduced 2-module sequence.
    await completeModules(PRACTICE_MODULE_TESTIDS)

    await waitFor(
      () => expect(screen.getByRole('heading', { name: /拆弹成功/ })).toBeInTheDocument(),
      { timeout: 5000 }
    )
  }, 12000)

  it('daily run: 4 modules → result page shows 拆弹成功', async () => {
    vi.mocked(loadManual).mockResolvedValue(yaml.load(practiceYamlRaw) as Manual)

    render(
      <MemoryRouter initialEntries={['/bombsquad/run?mode=daily']}>
        <App />
      </MemoryRouter>
    )

    // The terse "ready?" prompt appears once the mocked manual resolves.
    await waitFor(() => expect(screen.getByText('准备好了吗？')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /^开始$/ }))

    // Daily runs the full 4-module sequence.
    await completeModules(DAILY_MODULE_TESTIDS)

    await waitFor(
      () => expect(screen.getByRole('heading', { name: /拆弹成功/ })).toBeInTheDocument(),
      { timeout: 5000 }
    )
  }, 12000)
})
