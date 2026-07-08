/**
 * F-A regression: mode② (companion co-play, `?partner=platform`) 4-module
 * completion must reach settlement, never a phantom 「模块 5/4」.
 *
 * Root cause: `NEXT_MODULE`'s ALL_COMPLETE branch advances `currentModuleIndex`
 * to `moduleSequence.length` (past the last module). mode① navigates to the
 * result screen instantly, so that out-of-range index never renders. mode②
 * deliberately HOLDS the player on GamePage while the closing recap plays before
 * navigating — and during that hold the active-play module view computed
 * `模块 {index+1}/{length}` = 「模块 5/4」 over an empty panel.
 *
 * This test pins: while the mode② closing recap is held (requestClosing never
 * resolves), the game shows the settling screen — NOT 「模块 5/4」 — and once the
 * recap resolves it navigates to the win result page.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import yaml from 'js-yaml'
import type { Manual } from '@shared/manual-schema'

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

// A deferred that stands in for the closing-recap turn: while it stays pending
// the run is held on GamePage in the RESULT state — exactly the window the
// 「模块 5/4」 bug was visible in.
const closing = vi.hoisted(() => {
  let resolveClosing: () => void = () => {}
  const promise = new Promise<void>((res) => {
    resolveClosing = res
  })
  return { promise, resolve: () => resolveClosing() }
})

// Mock VoicePanel so mode② mounts without a real WebSocket / mic, and its
// imperative `requestClosing()` returns our controllable promise.
vi.mock('./voice/VoicePanel', async () => {
  const React = await import('react')
  return {
    __esModule: true,
    default: React.forwardRef(
      (_props: unknown, ref: React.Ref<{ requestClosing: () => Promise<void> }>) => {
        React.useImperativeHandle(ref, () => ({ requestClosing: () => closing.promise }))
        return React.createElement('div', { 'data-testid': 'mock-voice-panel' })
      }
    ),
  }
})

vi.mock('@shared/leaderboard-api', () => ({
  submitScore: vi.fn().mockResolvedValue({ ok: true, data: { rank: 5, total_players: 100 } }),
  fetchLeaderboard: vi.fn().mockResolvedValue({ date: '2026-07-08', entries: [] }),
}))

vi.mock('@/hooks/useCompanionPartner', () => ({
  useCompanionPartner: () => ({ status: 'unavailable' }),
}))

vi.mock('./utils/clipboard', () => ({
  copyToClipboard: vi.fn().mockResolvedValue(true),
}))

vi.mock('./audio/audio-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./audio/audio-context')>()
  return {
    ...actual,
    getAudioContext: vi.fn().mockReturnValue(null),
    setSfxSuppressed: vi.fn(),
  }
})

vi.mock('./utils/yaml-loader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./utils/yaml-loader')>()
  return { ...actual, loadManual: vi.fn() }
})

import App from './App'
import practiceYamlRaw from '../../manual/data/practice.yaml?raw'
import { loadManual } from './utils/yaml-loader'

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

describe('mode② daily settlement (F-A regression)', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.mocked(loadManual).mockResolvedValue(yaml.load(practiceYamlRaw) as Manual)
  })

  it('holds on a settling screen — never 「模块 5/4」 — then reaches the win page', async () => {
    render(
      <MemoryRouter initialEntries={['/bombsquad/run?mode=daily&partner=platform']}>
        <App />
      </MemoryRouter>
    )

    await waitFor(() => expect(screen.getByTestId('mock-wire-complete')).toBeInTheDocument(), {
      timeout: 3000,
    })

    await completeModules(DAILY_MODULE_TESTIDS)

    // The run is now held on GamePage while the (never-resolving) closing recap
    // plays: it must show the settling screen, NOT the phantom module counter.
    await waitFor(() => expect(screen.getByText(/正在收尾/)).toBeInTheDocument(), { timeout: 4000 })
    expect(document.body.textContent).not.toContain('5/4')
    expect(document.body.textContent).not.toContain('模块 5')
    // The active-play module panel is gone; the win result page has not arrived
    // yet (navigation is gated on the recap).
    expect(screen.queryByRole('heading', { name: /拆弹成功/ })).not.toBeInTheDocument()

    // Resolving the closing recap releases navigation to the win result page.
    closing.resolve()
    await waitFor(
      () => expect(screen.getByRole('heading', { name: /拆弹成功/ })).toBeInTheDocument(),
      { timeout: 5000 }
    )
  }, 15000)
})
