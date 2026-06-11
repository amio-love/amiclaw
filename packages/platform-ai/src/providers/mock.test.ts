import { describe, expect, it } from 'vitest'
import {
  createMockLlmProvider,
  createMockSpeechProvider,
  createMockSttProvider,
  createMockTtsProvider,
  MOCK_TRANSCRIPT,
} from './mock'
import type { ChatMessage } from './types'
import type { AudioChunk } from '../contract'

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const item of stream) out.push(item)
  return out
}

async function* audioFrames(...frames: AudioChunk[]): AsyncIterable<AudioChunk> {
  for (const f of frames) yield f
}

async function* sentences(...items: string[]): AsyncIterable<string> {
  for (const s of items) yield s
}

const decoder = new TextDecoder()

describe('createMockSttProvider', () => {
  it('drains the audio stream and yields the fixed final transcript', async () => {
    const stt = createMockSttProvider()
    const chunks = await collect(
      stt.transcribe(audioFrames(new Uint8Array([1, 2]), new Uint8Array([3, 4])))
    )
    expect(chunks).toEqual([{ text: MOCK_TRANSCRIPT, isFinal: true }])
  })

  it('yields the fixed transcript even for an empty audio stream', async () => {
    const stt = createMockSttProvider()
    const chunks = await collect(stt.transcribe(audioFrames()))
    expect(chunks).toEqual([{ text: MOCK_TRANSCRIPT, isFinal: true }])
  })
})

describe('createMockLlmProvider', () => {
  function systemWithManual(manualLine: string): ChatMessage[] {
    return [
      {
        role: 'system',
        content: `You are a guide.\n\nManual (version v1) — relevant sections:\n\n### module-a\n${manualLine}`,
      },
      { role: 'user', content: MOCK_TRANSCRIPT },
    ]
  }

  it('streams a deterministic manual-grounded reply ending in a done chunk', async () => {
    const llm = createMockLlmProvider()
    const chunks = await collect(
      llm.streamCompletion({ model: 'mock-llm', messages: systemWithManual('"红色按钮" => ABORT') })
    )
    const last = chunks[chunks.length - 1]
    expect(last).toEqual({ content: '', done: true })
    const text = chunks
      .slice(0, -1)
      .map((c) => c.content)
      .join('')
    // The reply visibly depends on the injected manual line.
    expect(text).toContain('"红色按钮" => ABORT')
  })

  it('is deterministic for identical input', async () => {
    const llm = createMockLlmProvider()
    const a = await collect(
      llm.streamCompletion({ model: 'mock-llm', messages: systemWithManual('X') })
    )
    const b = await collect(
      llm.streamCompletion({ model: 'mock-llm', messages: systemWithManual('X') })
    )
    expect(a).toEqual(b)
  })

  it('exposes lastUsage after the stream is drained', async () => {
    const llm = createMockLlmProvider({ usage: { inputTokens: 7, outputTokens: 9 } })
    await collect(llm.streamCompletion({ model: 'mock-llm', messages: systemWithManual('X') }))
    expect(llm.lastUsage).toEqual({ inputTokens: 7, outputTokens: 9 })
  })
})

describe('createMockTtsProvider', () => {
  it('maps each sentence to a UTF-8 audio frame plus a terminal done frame', async () => {
    const tts = createMockTtsProvider()
    const chunks = await collect(tts.synthesize(sentences('一句话。', '第二句。')))
    expect(chunks).toHaveLength(3)
    expect(decoder.decode(chunks[0].audio)).toBe('一句话。')
    expect(decoder.decode(chunks[1].audio)).toBe('第二句。')
    expect(chunks[2]).toEqual({ audio: new Uint8Array(0), done: true })
  })
})

describe('createMockSpeechProvider', () => {
  it('returns a shared stt + tts pair', () => {
    const pair = createMockSpeechProvider()
    expect(typeof pair.stt.transcribe).toBe('function')
    expect(typeof pair.tts.synthesize).toBe('function')
  })
})
