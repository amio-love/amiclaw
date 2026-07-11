import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import type { CoBuildAction } from '@shared/voice/voice-session-protocol'

/**
 * Capture the options the channel passes to `useGameVoiceSession` so a test can
 * drive the `onAction` / `getGameState` wiring without a real WebSocket session.
 */
const hook = vi.hoisted(() => ({
  onAction: null as null | ((actions: CoBuildAction[]) => void),
  getGameState: null as null | (() => unknown),
  session: {
    status: 'ready',
    conversationPhase: 'listening',
    aiText: '',
    playerTranscript: '',
    isAiSpeaking: false,
    error: null as string | null,
    openSession: vi.fn(),
    endSession: vi.fn(),
    requestClosing: vi.fn(() => Promise.resolve()),
  },
}))

vi.mock('@shared/voice/use-game-voice-session', () => ({
  useGameVoiceSession: (opts: {
    onAction?: (actions: CoBuildAction[]) => void
    getGameState?: () => unknown
  }) => {
    hook.onAction = opts.onAction ?? null
    hook.getGameState = opts.getGameState ?? null
    return hook.session
  },
}))

import SoundGardenPartnerChannel from './SoundGardenPartnerChannel'
import { GameStore } from '../game/store'
import { ScriptedPartnerBrain } from '../partner/brain'
import { levelByIndex } from '../game/levels'
import { buildSoundGardenManualData } from './sound-garden-manual'

const lv1 = levelByIndex(1)!

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  hook.onAction = null
  hook.getGameState = null
})

describe('SoundGardenPartnerChannel (mode② wiring)', () => {
  it('renders the live voice panel when the session is ready', () => {
    const store = new GameStore(lv1, 'melody', { partnerMode: 'platform' })
    render(
      <SoundGardenPartnerChannel
        store={store}
        gameId="sound-garden"
        manualData={buildSoundGardenManualData(lv1)}
      />
    )
    expect(screen.getByLabelText('AI 伙伴语音')).toBeInTheDocument()
    store.dispose()
  })

  it('onAction routes co_build moves through the legality guard into the engine board', () => {
    const store = new GameStore(lv1, 'melody', { partnerMode: 'platform' })
    store.plantPlayer('bell', 1)
    render(
      <SoundGardenPartnerChannel
        store={store}
        gameId="sound-garden"
        manualData={buildSoundGardenManualData(lv1)}
      />
    )
    expect(hook.onAction).toBeTypeOf('function')

    // A legal partner move + an illegal (wrong-lane) one arrive from the server.
    act(() => {
      hook.onAction?.([
        { op: 'place', pieceType: 'kick', slot: 1 },
        { op: 'place', pieceType: 'bell', slot: 2 }, // wrong lane → dropped by the guard
      ])
    })
    expect(store.getSnapshot().rhythm[0]).toBe('kick')
    expect(store.getSnapshot().rhythm[1]).toBeNull()
    expect(store.getSnapshot().score).toBe(3) // kick×bell synergy
    store.dispose()
  })

  it('getGameState exposes the live board publicContext for the speech-start pull', () => {
    const store = new GameStore(lv1, 'melody', { partnerMode: 'platform' })
    store.plantPlayer('bell', 1)
    render(
      <SoundGardenPartnerChannel
        store={store}
        gameId="sound-garden"
        manualData={buildSoundGardenManualData(lv1)}
      />
    )
    const gs = hook.getGameState?.() as {
      relevantSections: string[]
      publicContext: { melody: (string | null)[]; partnerArchetype: string }
    }
    expect(gs.relevantSections).toEqual(['matrix', 'rules'])
    expect(gs.publicContext.melody[0]).toBe('bell')
    expect(gs.publicContext.partnerArchetype).toBe('rhythm_piece')
    store.dispose()
  })

  it('fires the closing recap exactly once on the first bloom (§4 settlement)', async () => {
    const store = new GameStore(lv1, 'melody', { partnerMode: 'platform' })
    // The scripted brain computes the synergy rhythm for each planted melody, so
    // the test drives a real cooperative bloom without hardcoding the matrix.
    const brain = new ScriptedPartnerBrain(lv1.matrix, 'rhythm_piece')
    render(
      <SoundGardenPartnerChannel
        store={store}
        gameId="sound-garden"
        manualData={buildSoundGardenManualData(lv1)}
      />
    )

    for (const [type, slot] of [
      ['bell', 1],
      ['chime', 2],
      ['flute', 3],
      ['harp', 4],
    ] as const) {
      store.plantPlayer(type, slot)
      const reaction = await brain.react(store.voiceGameState().publicContext)
      await act(async () => {
        hook.onAction?.(reaction.actions)
      })
      if (store.getSnapshot().settled) break
    }

    expect(store.getSnapshot().settled).toBe(true)
    // Fire-and-forget recap, once per run (bloom = the `defused` win register).
    expect(hook.session.requestClosing).toHaveBeenCalledTimes(1)
    expect(hook.session.requestClosing).toHaveBeenCalledWith('defused')
    store.dispose()
  })
})
