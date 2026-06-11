/**
 * Capture-seam tests: the deterministic highlights excerpt, the
 * summary -> capture-input mapping, and the best-effort hand-off (a failing
 * consolidator must never throw into the session teardown path).
 */

import { describe, expect, it, vi } from 'vitest'
import {
  captureInputFromSummary,
  CONSOLIDATOR_DO_NAME,
  handOffSummaryCapture,
  summarizeHighlights,
  type ConsolidatorNamespace,
} from './companion-capture'
import type { SessionSummary } from './contract'
import { createDistillLlm } from './distill-llm'
import type { LlmCompletionChunk, LlmProvider } from './providers/types'

const SUMMARY: SessionSummary = {
  sessionId: 'sess-1',
  gameId: 'bombsquad',
  userId: 'user-a',
  turnCount: 3,
  usage: { llmInputTokens: 0, llmOutputTokens: 0, sttInputSeconds: 0, ttsOutputSeconds: 0 },
  highlights: ['user: which wire?'],
  gameRunId: 'run-1',
  occurredAt: '2026-06-11T10:00:00.000Z',
}

describe('summarizeHighlights', () => {
  it('prefixes roles, truncates long lines, and caps the message count', () => {
    const long = 'x'.repeat(500)
    const history = [
      ...Array.from({ length: 25 }, (_, i) => ({
        role: 'user' as const,
        content: `turn ${i}`,
      })),
      { role: 'assistant' as const, content: long },
    ]
    const highlights = summarizeHighlights(history)
    expect(highlights).toHaveLength(20)
    expect(highlights[0]).toBe('user: turn 6')
    const last = highlights[highlights.length - 1]
    expect(last.startsWith('assistant: ')).toBe(true)
    expect(last.length).toBeLessThanOrEqual('assistant: '.length + 200)
    expect(last.endsWith('…')).toBe(true)
  })

  it('yields an empty array for an empty history (capture degrades downstream)', () => {
    expect(summarizeHighlights([])).toEqual([])
  })
})

describe('captureInputFromSummary', () => {
  it('maps all capture fields and omits absent optionals', () => {
    expect(captureInputFromSummary(SUMMARY)).toEqual({
      sessionId: 'sess-1',
      gameId: 'bombsquad',
      userId: 'user-a',
      turnCount: 3,
      highlights: ['user: which wire?'],
      gameRunId: 'run-1',
      occurredAt: '2026-06-11T10:00:00.000Z',
    })
    const bare = captureInputFromSummary({
      ...SUMMARY,
      highlights: undefined,
      gameRunId: undefined,
      occurredAt: undefined,
    })
    expect('highlights' in bare).toBe(false)
    expect('gameRunId' in bare).toBe(false)
    expect('occurredAt' in bare).toBe(false)
  })
})

describe('handOffSummaryCapture', () => {
  it('POSTs the summary to the singleton consolidator', async () => {
    const fetched: Request[] = []
    const namespace: ConsolidatorNamespace = {
      idFromName: (name: string) => name,
      get: (id: unknown) => {
        expect(id).toBe(CONSOLIDATOR_DO_NAME)
        return {
          fetch: async (request: Request) => {
            fetched.push(request)
            return new Response('{}')
          },
        }
      },
    }
    await handOffSummaryCapture(namespace, SUMMARY)
    expect(fetched).toHaveLength(1)
    expect(fetched[0].method).toBe('POST')
    expect(new URL(fetched[0].url).pathname).toBe('/capture')
    expect(await fetched[0].json()).toMatchObject({ sessionId: 'sess-1', userId: 'user-a' })
  })

  it('swallows consolidator failures (memory is best-effort, teardown is sacred)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const namespace: ConsolidatorNamespace = {
        idFromName: (name: string) => name,
        get: () => ({
          fetch: async () => {
            throw new Error('consolidator down')
          },
        }),
      }
      await expect(handOffSummaryCapture(namespace, SUMMARY)).resolves.toBeUndefined()
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('is a no-op without the binding', async () => {
    await expect(handOffSummaryCapture(undefined, SUMMARY)).resolves.toBeUndefined()
  })
})

describe('createDistillLlm', () => {
  it('drains the streamed completion into one string', async () => {
    const provider: LlmProvider = {
      async *streamCompletion(): AsyncIterable<LlmCompletionChunk> {
        yield { content: '{"episodes":', done: false }
        yield { content: '[],"claims":[]}', done: true }
      },
    }
    const llm = createDistillLlm(provider, 'test-model')
    expect(await llm.complete('prompt')).toBe('{"episodes":[],"claims":[]}')
  })
})
