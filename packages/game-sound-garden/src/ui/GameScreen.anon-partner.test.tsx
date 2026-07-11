import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// Anon tier: force ineligible so GameScreen mounts the scripted partner store
// synchronously (no async eligibility fetch).
vi.mock('../voice/sound-garden-voice-eligibility', () => ({
  useSoundGardenVoiceEligibility: () => ({ status: 'ineligible', reason: 'unavailable' }),
}))

import { GameScreen } from './GameScreen'
import { levelByIndex } from '../game/levels'

const lv1 = levelByIndex(1)!

/**
 * A `speechSynthesis` whose `speak()` NEVER fires `onend` — faithfully models a
 * real browser that throttles / never resolves speech with no user gesture. This
 * is exactly the condition that deadlocked the anon partner: the session_start
 * greeting's `voice.speak` hung, keeping the serial trigger bus `busy` forever, so
 * every later `player_planted` was swallowed.
 */
class HangingUtterance {
  lang = ''
  onend: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(public text: string) {}
}

beforeEach(() => {
  vi.stubGlobal('speechSynthesis', { speak: vi.fn(), cancel: vi.fn() })
  vi.stubGlobal('SpeechSynthesisUtterance', HangingUtterance)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function filledRhythmCells(container: HTMLElement): number {
  return container.querySelectorAll('.sg-cell.rhythm.filled').length
}

describe('GameScreen anon partner — UI → trigger-bus → brain wiring (live regression)', () => {
  it('responds to a plant with a partner rhythm piece even when TTS never resolves', async () => {
    const { container } = render(
      <GameScreen
        level={lv1}
        side="melody"
        hasNext={false}
        onExit={() => undefined}
        onReplay={() => undefined}
        onNext={() => undefined}
      />
    )

    // session_start applied: the greeting + the pre-seed 底鼓@1 (one filled rhythm
    // cell). This renders BEFORE the (now non-blocking) greeting speech.
    await screen.findByText(/一起让花园唱起来/)
    await waitFor(() => expect(filledRhythmCells(container)).toBe(1))

    // Plant a melody piece on an EMPTY beat (slot 2), where the partner has a move.
    fireEvent.click(screen.getByLabelText(/选择铃铛/))
    fireEvent.click(screen.getByLabelText('旋律 第2拍'))

    // The partner must lay a rhythm piece within the debounce window. Before the
    // fix the serial bus stayed `busy` on the hung greeting speech, so this never
    // happened and the wait times out (the regression).
    await waitFor(() => expect(filledRhythmCells(container)).toBe(2), { timeout: 2500 })
  })
})
