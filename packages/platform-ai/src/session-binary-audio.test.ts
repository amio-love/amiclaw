import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Production-class regression test for binary-audio FIDELITY through the REAL
 * `VoiceSessionDO.onMessage` path, driving the genuine Cloudflare Durable Object
 * under the workerd runtime (`@cloudflare/vitest-pool-workers`).
 *
 * The blind spot this closes: the existing DO suites drive turns through a
 * counting STT that drains the audio bridge WITHOUT inspecting the bytes
 * ("frames are consumed, not inspected"), so they pass whether the frame that
 * reached STT is byte-intact or empty. The migration's `onMessage` converts an
 * inbound binary frame with `new Uint8Array(message)`, which is only correct if
 * the frame arrives as an `ArrayBuffer`. Under this Worker's
 * `compatibility_date` (2026-06-08) a standard accepted WebSocket delivers
 * binary as a `Blob` unless `binaryType = 'arraybuffer'` is set BEFORE
 * `accept()` — and partyserver (the Agents-SDK base) sets it AFTER `accept()`.
 * On a `Blob`, `new Uint8Array(blob)` yields an EMPTY view, so every voice turn
 * would feed empty audio to STT.
 *
 * This test drives a genuine binary frame (`socket.send(<ArrayBuffer>)`) over
 * the real workerd WebSocket — exactly as the other DO suites drive control
 * frames — and asserts, via the byte-inspecting STT, that the bytes reaching STT
 * are non-empty AND byte-equal to what the client sent.
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

import { audioFrameToBytes } from './session-do'
import {
  createSessionOverWs,
  makeInspectingProviders,
  makeSessionDo,
  messagesOfType,
  openSocket,
  sawDoneChunk,
  waitFor,
  waitForMessage,
} from './session-do-test-kit'

beforeEach(() => {
  providerControl.override = undefined
})

const TURN = JSON.stringify({ type: 'turn' })
const END = JSON.stringify({ type: 'end' })

describe('real VoiceSessionDO — binary audio reaches STT byte-intact (P1)', () => {
  it('an ArrayBuffer audio frame reaches STT non-empty and byte-equal to what was sent', async () => {
    const kit = makeInspectingProviders()
    providerControl.override = kit.providers
    const session = makeSessionDo()
    const socket = await openSocket(session, 'user-A')
    await createSessionOverWs(socket)

    // A genuine binary audio frame: distinct non-zero bytes so an empty (the
    // Blob-conversion bug) or garbage view is unmistakable in the assertion.
    const AUDIO = new Uint8Array([0x10, 0x20, 0x30, 0x40, 0x50, 0x60])
    socket.send(AUDIO.slice().buffer)

    // Run the turn; STT drains the buffered bridge and captures the frames it
    // pulled. WS delivery is ordered, so the binary frame is pushed onto the
    // bridge before the turn closes it.
    socket.send(TURN)
    await waitFor(() => kit.sttCalls() === 1, 'turn ran STT once')
    await waitFor(() => sawDoneChunk(socket), 'turn emitted its terminal done chunk')

    // The crux: the bytes that reached STT are non-empty AND exactly the bytes
    // the client sent — not the empty view `new Uint8Array(blob)` produces.
    const received = kit.bytes()
    expect(received.byteLength).toBe(AUDIO.byteLength)
    expect(received.byteLength).toBeGreaterThan(0)
    expect(Array.from(received)).toEqual(Array.from(AUDIO))

    socket.send(END)
    await waitForMessage(socket, 'summary')
    expect(messagesOfType(socket, 'summary')).toHaveLength(1)
  })

  it('preserves bytes across multiple binary frames in one turn', async () => {
    const kit = makeInspectingProviders()
    providerControl.override = kit.providers
    const session = makeSessionDo()
    const socket = await openSocket(session, 'user-A')
    await createSessionOverWs(socket)

    const FRAME_1 = new Uint8Array([0x01, 0x02, 0x03])
    const FRAME_2 = new Uint8Array([0xfa, 0xfb, 0xfc, 0xfd])
    socket.send(FRAME_1.slice().buffer)
    socket.send(FRAME_2.slice().buffer)

    socket.send(TURN)
    await waitFor(() => kit.sttCalls() === 1, 'turn ran STT once')
    await waitFor(() => sawDoneChunk(socket), 'turn emitted its terminal done chunk')

    // Both frames reach STT, in order, byte-for-byte — the concatenation equals
    // the two sent frames back to back.
    const expected = [...FRAME_1, ...FRAME_2]
    expect(Array.from(kit.bytes())).toEqual(expected)
    expect(kit.frames()).toHaveLength(2)

    socket.send(END)
    await waitForMessage(socket, 'summary')
  })
})

describe('audioFrameToBytes — defensive binary normalization (regardless of binaryType)', () => {
  // In this workerd runtime partyserver's `binaryType = 'arraybuffer'` makes the
  // real WS deliver `ArrayBuffer` (covered above), so the `Blob` / view branches
  // are not reachable through the live socket. These unit tests pin the
  // defensive conversion that protects against a future runtime/SDK change that
  // delivers a different shape — the exact regression the migration's
  // `new Uint8Array(message)` would have silently corrupted on a `Blob`.
  const BYTES = new Uint8Array([0x10, 0x20, 0x30, 0x40])

  it('wraps an ArrayBuffer directly, byte-for-byte', async () => {
    const out = await audioFrameToBytes(BYTES.slice().buffer)
    expect(Array.from(out)).toEqual(Array.from(BYTES))
  })

  it('reads a Blob via arrayBuffer() — NOT the empty view new Uint8Array(blob) yields', async () => {
    const blob = new Blob([BYTES])
    // The bug shape: a naive synchronous wrap loses the bytes.
    expect(new Uint8Array(blob as unknown as ArrayBuffer).byteLength).toBe(0)
    // The fix recovers them.
    const out = await audioFrameToBytes(blob)
    expect(out.byteLength).toBe(BYTES.byteLength)
    expect(Array.from(out)).toEqual(Array.from(BYTES))
  })

  it('normalizes an ArrayBufferView over its exact byte range (subview, not the whole buffer)', async () => {
    // A view that starts at offset 2 with length 4 inside a larger buffer.
    const backing = new Uint8Array([0, 0, 0x10, 0x20, 0x30, 0x40, 0, 0])
    const view = new Uint8Array(backing.buffer, 2, 4)
    const out = await audioFrameToBytes(view)
    expect(Array.from(out)).toEqual([0x10, 0x20, 0x30, 0x40])
  })

  it('rejects an unsupported frame shape (fail-loud, 1008 by the caller)', async () => {
    await expect(audioFrameToBytes(42 as unknown as ArrayBuffer)).rejects.toThrow(
      /unsupported binary audio frame/
    )
  })
})
