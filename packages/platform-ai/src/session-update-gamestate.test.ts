import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Production-class tests for the `update-gamestate` control message, driving the
 * REAL `VoiceSessionDO` under the workerd runtime (`@cloudflare/vitest-pool-workers`).
 *
 * The feature: a BombSquad mode② voice session spans a WHOLE daily run as ONE
 * continuous conversation. When the player advances modules, the client keeps the
 * SAME session and sends `{type:'update-gamestate', gameState:{relevantSections}}`
 * so the DO re-selects which manual subset the NEXT turn injects — WITHOUT
 * creating a new session, resetting history, re-running the AI-first greeting, or
 * disturbing an in-flight turn. `manualData` (the whole manual) was already passed
 * at `create`; only which sections are injected changes.
 *
 * Harness (see `session-do-test-kit.ts`): the gated provider bundle captures each
 * turn's `LlmCompletionRequest`. The request's system message (`messages[0]`)
 * carries the deterministic manual injection (`assembleLlmContext`), so a test can
 * assert WHICH sections the turn injected by substring-matching the system text.
 */

const providerControl = vi.hoisted(() => ({
  override: undefined as import('./turn-pipeline').TurnProviders | undefined,
}))

vi.mock('./providers/factory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./providers/factory')>()
  return {
    ...actual,
    createProviders: (...args: Parameters<typeof actual.createProviders>) =>
      providerControl.override ?? actual.createProviders(...args),
  }
})

import {
  driveUtteranceToLlm,
  makeGatedProviders,
  makeSessionDo,
  messagesOfType,
  openSocket,
  sawDoneChunk,
  settle,
  waitFor,
  waitForMessage,
  type TestSocket,
} from './session-do-test-kit'

beforeEach(() => {
  providerControl.override = undefined
})

const END = JSON.stringify({ type: 'end' })

// A two-module manual: each section value is an unambiguous marker so a test can
// tell which subset reached the LLM by substring-matching the system message.
const ALPHA = 'ALPHA-SECTION-MARKER'
const BRAVO = 'BRAVO-SECTION-MARKER'
const MULTI_MANUAL = {
  version: 'manual-v1',
  sections: { moduleA: ALPHA, moduleB: BRAVO },
}

/** Send a `create` with a custom manual + initial gameState; await the ack. */
async function createWith(socket: TestSocket, relevantSections: string[]): Promise<void> {
  socket.send(
    JSON.stringify({
      type: 'create',
      gameId: 'demo-mock',
      manualData: MULTI_MANUAL,
      gameState: { relevantSections },
      opening: false,
    })
  )
  await waitForMessage(socket, 'created')
}

/** The system message text the gated LLM captured for turn index `i`. */
function systemTextOfTurn(kit: ReturnType<typeof makeGatedProviders>, i: number): string {
  return kit.llmTurns[i].request.messages[0].content
}

describe('real VoiceSessionDO — update-gamestate (continuous run, module advance)', () => {
  it('a mid-session update changes the NEXT turn injection without reset/re-greet/history-loss; the in-flight turn is undisturbed', async () => {
    const kit = makeGatedProviders()
    providerControl.override = kit.providers
    const session = makeSessionDo()
    const socket = await openSocket(session, 'user-A')
    await createWith(socket, ['moduleA'])

    // Turn 1 (module A): speech-start opens STT, turn finalizes -> the reply parks
    // at the gated LLM. Its captured request injects module A's subset, not B's.
    await driveUtteranceToLlm(socket, kit, 1)
    expect(systemTextOfTurn(kit, 0)).toContain(ALPHA)
    expect(systemTextOfTurn(kit, 0)).not.toContain(BRAVO)
    // No history yet → system + the current player utterance only.
    expect(kit.llmTurns[0].request.messages).toHaveLength(2)

    // The player advances to module B WHILE turn 1 is still in flight. This must
    // not disturb the running turn (it already snapshotted its messages) and must
    // not error / close the socket.
    socket.send(
      JSON.stringify({ type: 'update-gamestate', gameState: { relevantSections: ['moduleB'] } })
    )
    await settle()
    expect(messagesOfType(socket, 'error')).toEqual([])
    expect(socket.closeEvents).toEqual([])
    // The in-flight turn's already-captured request is unchanged.
    expect(systemTextOfTurn(kit, 0)).toContain(ALPHA)
    expect(systemTextOfTurn(kit, 0)).not.toContain(BRAVO)

    // Finish turn 1.
    await session.run(() => kit.llmTurns[0].pushDelta('Cut the third wire.'))
    await session.run(() => kit.llmTurns[0].finishStream())
    await waitFor(() => kit.llmTurns[0].settled(), 'turn 1 settled')
    await waitFor(() => sawDoneChunk(socket), 'turn 1 done chunk')

    // Turn 2 (after the update) injects module B's subset, not module A's — proving
    // the update took effect on the next turn.
    await driveUtteranceToLlm(socket, kit, 2)
    expect(systemTextOfTurn(kit, 1)).toContain(BRAVO)
    expect(systemTextOfTurn(kit, 1)).not.toContain(ALPHA)
    // History PERSISTED across the update: turn 2 carries turn 1's user+assistant
    // messages (system + 2 history + current player utterance = 4), so the session
    // was never reset.
    expect(kit.llmTurns[1].request.messages).toHaveLength(4)
    expect(kit.llmTurns[1].request.messages[2]).toEqual({
      role: 'assistant',
      content: 'Cut the third wire.',
    })

    // No re-create and no re-greet: exactly one `created` ack, and exactly two
    // LLM turns total (the two player turns — the update injected no extra turn).
    expect(messagesOfType(socket, 'created')).toHaveLength(1)
    expect(kit.llmTurns).toHaveLength(2)

    await session.run(() => kit.llmTurns[1].finishStream())
    await waitFor(() => kit.llmTurns[1].settled(), 'turn 2 settled')

    // Both turns counted in the one continuous session's summary.
    socket.send(END)
    await waitForMessage(socket, 'summary')
    const summary = messagesOfType(socket, 'summary')[0].summary as { turnCount: number }
    expect(summary.turnCount).toBe(2)
  })

  it('is a benign no-op for an invalid payload and for a non-owner socket (no 1008, no injection change)', async () => {
    const kit = makeGatedProviders()
    providerControl.override = kit.providers
    const session = makeSessionDo()
    const owner = await openSocket(session, 'user-A')
    await createWith(owner, ['moduleA'])

    // Malformed update from the OWNER: missing `relevantSections` / wrong types.
    // Must be ignored, never a 1008 close (that would drop the whole conversation).
    owner.send(JSON.stringify({ type: 'update-gamestate' }))
    owner.send(JSON.stringify({ type: 'update-gamestate', gameState: {} }))
    owner.send(
      JSON.stringify({ type: 'update-gamestate', gameState: { relevantSections: 'moduleB' } })
    )
    owner.send(JSON.stringify({ type: 'update-gamestate', gameState: { relevantSections: [42] } }))

    // A SECOND authenticated socket for the SAME user (a duplicate tab) is not the
    // owner socket — its update must not redirect the owner's injected manual.
    const duplicate = await openSocket(session, 'user-A')
    duplicate.send(
      JSON.stringify({ type: 'update-gamestate', gameState: { relevantSections: ['moduleB'] } })
    )
    await settle()
    expect(owner.closeEvents).toEqual([])
    expect(duplicate.closeEvents).toEqual([])
    expect(messagesOfType(owner, 'error')).toEqual([])

    // The owner's next turn still injects module A — neither the malformed owner
    // updates nor the non-owner update changed the live selection.
    await driveUtteranceToLlm(owner, kit, 1)
    expect(systemTextOfTurn(kit, 0)).toContain(ALPHA)
    expect(systemTextOfTurn(kit, 0)).not.toContain(BRAVO)
  })
})
