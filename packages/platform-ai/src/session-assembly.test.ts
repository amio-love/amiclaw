import { describe, expect, it } from 'vitest'
import { assembleSession } from './session-assembly'
import { assertSocketOwnsBoundSession, SocketIdentityRegistry } from './auth-seam'
import type { ManualData } from './contract'
import type { ProviderEnv } from './providers/factory'

/**
 * Regression tests for the partial-publish atomicity defect in
 * `VoiceSessionDO.createSession`.
 *
 * The defect: the old `createSession` published `this.userId` BEFORE the
 * fallible `createProviders` step. `boundIdentity()` derives the session's
 * ownership binding solely from `this.userId`, so the attack chain was:
 *  1. `create` for a real-provider game (e.g. `demo` → DeepSeek + Volcengine)
 *     with a secret missing → `createProviders` throws AFTER `userId` was set;
 *  2. the DO now reports a bound, owned session with NO `state`/`providers`;
 *  3. binary frames from a socket authenticated as that user pass the
 *     ownership gate, lazily create the audio bridge, and enqueue leaked
 *     pre-create audio;
 *  4. the next SUCCESSFUL `create` does not reset `this.audio`, so the stale
 *     bridge — leaked frames included — survives into the new session's first
 *     turn.
 *
 * The fix extracts every fallible setup step into the pure `assembleSession`
 * (locals only, complete-bundle-or-throw); the DO publishes the bundle in one
 * uninterrupted synchronous block. The DO class itself imports
 * `cloudflare:workers` and cannot be instantiated in the Node test
 * environment, so — exactly as `session-identity.test.ts` does — these tests
 * exercise the extracted pure pieces and model the DO's publish + observer
 * shape around them.
 */

const MANUAL: ManualData = { version: 'test-v1', sections: { intro: 'sample section' } }

describe('assembleSession — all-or-nothing session construction', () => {
  it('throws on an unregistered gameId and returns no bundle', () => {
    expect(() => assembleSession('no-such-game', 'user-A', MANUAL, undefined, {})).toThrow(
      /no configuration registered/
    )
  })

  it('throws when the selected real LLM provider is missing its secret', () => {
    // `demo` selects the real DeepSeek LLM; an env without DEEPSEEK_API_KEY is
    // exactly the missing-secret deploy misconfiguration of the attack chain.
    expect(() => assembleSession('demo', 'user-A', MANUAL, undefined, {})).toThrow(
      /DEEPSEEK_API_KEY/
    )
  })

  it('throws when the selected real speech provider is missing its secret', () => {
    // The LLM credential is present, so the throw comes from the LATER
    // Volcengine step — the deepest fallible point. Under the old code the
    // user id had long been published by the time this threw.
    const env: ProviderEnv = { DEEPSEEK_API_KEY: 'test-key' }
    expect(() => assembleSession('demo', 'user-A', MANUAL, undefined, env)).toThrow(/VOLC_APP_ID/)
  })

  it('returns the complete publishable bundle when every step succeeds', () => {
    // `demo-mock` wires the deterministic mock providers — no credentials.
    const assembled = assembleSession('demo-mock', 'user-A', MANUAL, undefined, {})

    expect(assembled.userId).toBe('user-A')
    expect(assembled.providers.stt).toBeDefined()
    expect(assembled.providers.llm).toBeDefined()
    expect(assembled.providers.tts).toBeDefined()
    expect(assembled.state.config.gameId).toBe('demo-mock')
    expect(assembled.state.manualData).toBe(MANUAL)
    // Omitted game state defaults to the empty injection selection.
    expect(assembled.state.gameState).toEqual({ relevantSections: [] })
    expect(assembled.state.history).toEqual([])
    expect(assembled.state.turnCount).toBe(0)
    expect(assembled.state.usage).toEqual({
      llmInputTokens: 0,
      llmOutputTokens: 0,
      sttInputSeconds: 0,
      ttsOutputSeconds: 0,
    })
  })

  it('threads an explicit gameState through to the assembled state', () => {
    const gameState = { relevantSections: ['wires', 'button'] }
    const assembled = assembleSession('demo-mock', 'user-A', MANUAL, gameState, {})

    expect(assembled.state.gameState).toEqual(gameState)
  })
})

describe('failed create publishes nothing — no half-bound session, no leaked audio', () => {
  /** A stand-in socket — only reference identity matters to the registry. */
  type FakeSocket = { id: string }
  const socketA: FakeSocket = { id: 'socketA' }

  /**
   * Models the DO around the real extracted pieces: the session fields +
   * `boundIdentity()` (binding derived solely from `userId`), `createSession`'s
   * assemble-then-publish, and `onSocketMessage`'s binary branch (per-socket
   * ownership gate, then lazy bridge + push) — the exact observer chain the
   * half-bound state used to fool.
   */
  function makeDo() {
    const DO_ID = 'do-session-1'
    let userId: string | undefined
    const reg = new SocketIdentityRegistry<FakeSocket>()
    reg.bind(socketA, 'user-A')
    let bridge: Uint8Array[] | undefined

    // Mirrors VoiceSessionDO.createSession: assemble into a local, then publish.
    function createSession(gameId: string, env: ProviderEnv): void {
      const assembled = assembleSession(gameId, 'user-A', MANUAL, undefined, env)
      userId = assembled.userId
    }

    // Mirrors VoiceSessionDO.boundIdentity.
    const boundIdentity = () => ({
      boundSessionId: userId === undefined ? undefined : DO_ID,
      boundUserId: userId,
    })

    // Mirrors onSocketMessage's binary branch: gate, then lazy-create + push.
    function feedBinaryFrame(socket: FakeSocket, frame: Uint8Array): void {
      assertSocketOwnsBoundSession(reg, socket, boundIdentity())
      if (bridge === undefined) bridge = []
      bridge.push(frame)
    }

    return { createSession, boundIdentity, feedBinaryFrame, bridgeFrames: () => bridge }
  }

  it('a create that fails on a missing provider secret leaves the DO unbound', () => {
    const { createSession, boundIdentity } = makeDo()

    // The real-provider create aborts inside createProviders (missing secret).
    expect(() => createSession('demo', {})).toThrow(/DEEPSEEK_API_KEY/)

    // The old code would now report a bound, owned session (userId published
    // before the throw). The fix publishes nothing: still entirely absent.
    expect(boundIdentity()).toEqual({ boundSessionId: undefined, boundUserId: undefined })
  })

  it('binary frames after the failed create are rejected — no leaked bridge', () => {
    const { createSession, feedBinaryFrame, bridgeFrames } = makeDo()

    expect(() => createSession('demo', {})).toThrow(/DEEPSEEK_API_KEY/)

    // Attack step 3: the same authenticated user pushes audio into the
    // failed-create window. With no binding published, the ownership gate
    // fails loud ("before createSession") and no bridge is ever created.
    expect(() => feedBinaryFrame(socketA, new Uint8Array([9, 9, 9]))).toThrow(
      /before createSession/
    )
    expect(bridgeFrames()).toBeUndefined()
  })

  it('the next successful create starts with a clean bridge — no frames from the failed window', () => {
    const { createSession, boundIdentity, feedBinaryFrame, bridgeFrames } = makeDo()

    // Failed-create window: nothing binds, the leaked frame is rejected.
    expect(() => createSession('demo', {})).toThrow(/DEEPSEEK_API_KEY/)
    expect(() => feedBinaryFrame(socketA, new Uint8Array([0xff]))).toThrow(/before createSession/)

    // Attack step 4's precondition is gone: when the retry succeeds (mock
    // providers, no credentials), the session starts with NO inherited audio —
    // only frames pushed after the successful create reach the bridge.
    createSession('demo-mock', {})
    expect(boundIdentity()).toEqual({ boundSessionId: 'do-session-1', boundUserId: 'user-A' })

    const ownFrame = new Uint8Array([1, 2, 3])
    feedBinaryFrame(socketA, ownFrame)
    expect(bridgeFrames()).toEqual([ownFrame])
  })
})
