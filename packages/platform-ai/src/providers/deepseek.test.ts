import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createDeepSeekLlmProvider,
  parseSseLine,
  sseStreamToChunks,
  trimTrailingSlashes,
} from './deepseek'
import { TIMEOUTS } from './timeout'
import type { LlmCompletionChunk, LlmCompletionRequest } from './types'

// --- helpers -------------------------------------------------------------

/** Build a `ReadableStream<Uint8Array>` that emits `sse` as one or more byte
 * pushes. Passing multiple strings simulates the body arriving in several
 * network reads (exercising cross-chunk line buffering). */
function sseStream(...pushes: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const push of pushes) controller.enqueue(encoder.encode(push))
      controller.close()
    },
  })
}

/** One DeepSeek-shaped content delta SSE line. */
function deltaLine(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n`
}

/** Drain an async iterable of chunks into an array. */
async function collect(iterable: AsyncIterable<LlmCompletionChunk>): Promise<LlmCompletionChunk[]> {
  const out: LlmCompletionChunk[] = []
  for await (const chunk of iterable) out.push(chunk)
  return out
}

/** Stub `fetch` to return a streaming Response built from `body`. The mock is
 * typed with an explicit `(url, init)` signature so `mock.calls` carries the
 * request tuple for assertions. */
function stubFetch(body: ReadableStream<Uint8Array> | null, init?: ResponseInit) {
  const fetchMock = vi.fn(
    async (_url: string, _init?: RequestInit): Promise<Response> => new Response(body, init)
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const baseRequest: LlmCompletionRequest = {
  model: 'deepseek-v4-flash',
  messages: [{ role: 'user', content: 'hi' }],
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// --- parseSseLine (pure) -------------------------------------------------

describe('parseSseLine', () => {
  it('parses a content delta line', () => {
    expect(parseSseLine(deltaLine('hello').trimEnd())).toEqual({
      type: 'delta',
      content: 'hello',
    })
  })

  it('maps the [DONE] sentinel to a done event', () => {
    expect(parseSseLine('data: [DONE]')).toEqual({ type: 'done' })
  })

  it('ignores the role-only first chunk (empty delta)', () => {
    const roleOnly = `data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant' } }] })}`
    expect(parseSseLine(roleOnly)).toEqual({ type: 'ignore' })
  })

  it('ignores an explicit empty-string content delta', () => {
    expect(parseSseLine(deltaLine('').trimEnd())).toEqual({ type: 'ignore' })
  })

  it('ignores blank lines, comments, and non-data fields', () => {
    expect(parseSseLine('')).toEqual({ type: 'ignore' })
    expect(parseSseLine(': keep-alive')).toEqual({ type: 'ignore' })
    expect(parseSseLine('event: message')).toEqual({ type: 'ignore' })
  })

  it('ignores an unparseable data payload rather than throwing', () => {
    expect(parseSseLine('data: {not json')).toEqual({ type: 'ignore' })
  })

  it('extracts a usage report from the final chunk', () => {
    const usageLine = `data: ${JSON.stringify({
      choices: [],
      usage: { prompt_tokens: 12, completion_tokens: 34 },
    })}`
    expect(parseSseLine(usageLine)).toEqual({
      type: 'usage',
      usage: { inputTokens: 12, outputTokens: 34 },
    })
  })
})

// --- trimTrailingSlashes (linear, no ReDoS) ------------------------------

describe('trimTrailingSlashes', () => {
  it('strips one or more trailing slashes', () => {
    expect(trimTrailingSlashes('https://api.deepseek.com/v1/')).toBe('https://api.deepseek.com/v1')
    expect(trimTrailingSlashes('https://proxy.example.com/v1///')).toBe(
      'https://proxy.example.com/v1'
    )
  })

  it('leaves a slash-free base url unchanged', () => {
    expect(trimTrailingSlashes('https://api.deepseek.com/v1')).toBe('https://api.deepseek.com/v1')
  })

  it('handles an all-slash and empty string without underflow', () => {
    expect(trimTrailingSlashes('////')).toBe('')
    expect(trimTrailingSlashes('')).toBe('')
  })

  it('returns fast on a long run of slashes that fails the end-anchor (no ReDoS)', () => {
    // The replaced `/\/+$/` regex backtracks polynomially on this exact shape
    // (a long run of `/` immediately followed by a non-`/`, so the `$` anchor
    // fails and the engine re-tries every start position). The linear scan must
    // stay well under any reasonable bound regardless of length.
    const adversarial = `${'/'.repeat(200_000)}x`
    const start = performance.now()
    const result = trimTrailingSlashes(adversarial)
    const elapsedMs = performance.now() - start
    // No trailing slash to strip (input ends in 'x'), so the value is unchanged.
    expect(result).toBe(adversarial)
    // The vulnerable regex took ~19s for this input; linear is sub-millisecond.
    expect(elapsedMs).toBeLessThan(50)
  })
})

// --- sseStreamToChunks (pure) --------------------------------------------

describe('sseStreamToChunks', () => {
  it('concatenates multiple deltas and ends with a single done chunk', async () => {
    const stream = sseStream(
      deltaLine('Hel'),
      deltaLine('lo, '),
      deltaLine('world'),
      'data: [DONE]\n'
    )
    const chunks = await collect(sseStreamToChunks(stream))
    expect(chunks).toEqual([
      { content: 'Hel', done: false },
      { content: 'lo, ', done: false },
      { content: 'world', done: false },
      { content: '', done: true },
    ])
  })

  it('reassembles a delta split across two network reads', async () => {
    // The JSON for one delta is cut mid-line; the buffer must stitch it back.
    const full = deltaLine('spanning')
    const cut = Math.floor(full.length / 2)
    const stream = sseStream(full.slice(0, cut), `${full.slice(cut)}data: [DONE]\n`)
    const chunks = await collect(sseStreamToChunks(stream))
    expect(chunks).toEqual([
      { content: 'spanning', done: false },
      { content: '', done: true },
    ])
  })

  it('skips empty deltas in the stream', async () => {
    const stream = sseStream(deltaLine('a'), deltaLine(''), deltaLine('b'), 'data: [DONE]\n')
    const chunks = await collect(sseStreamToChunks(stream))
    expect(chunks).toEqual([
      { content: 'a', done: false },
      { content: 'b', done: false },
      { content: '', done: true },
    ])
  })

  it('emits a terminal done chunk even when the stream omits [DONE]', async () => {
    const stream = sseStream(deltaLine('only'))
    const chunks = await collect(sseStreamToChunks(stream))
    expect(chunks).toEqual([
      { content: 'only', done: false },
      { content: '', done: true },
    ])
  })

  it('reports usage via the callback without placing it on the chunk stream', async () => {
    const usageLine = `data: ${JSON.stringify({
      choices: [],
      usage: { prompt_tokens: 5, completion_tokens: 7 },
    })}\n`
    const stream = sseStream(deltaLine('x'), usageLine, 'data: [DONE]\n')
    const onUsage = vi.fn()
    const chunks = await collect(sseStreamToChunks(stream, onUsage))
    expect(chunks).toEqual([
      { content: 'x', done: false },
      { content: '', done: true },
    ])
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 5, outputTokens: 7 })
  })
})

// --- createDeepSeekLlmProvider (mocked fetch) ----------------------------

describe('createDeepSeekLlmProvider', () => {
  it('streams concatenated deltas and a done chunk through the provider', async () => {
    stubFetch(sseStream(deltaLine('Po'), deltaLine('ng'), 'data: [DONE]\n'))
    const provider = createDeepSeekLlmProvider({ apiKey: 'sk-test' })
    const chunks = await collect(provider.streamCompletion(baseRequest))
    expect(chunks).toEqual([
      { content: 'Po', done: false },
      { content: 'ng', done: false },
      { content: '', done: true },
    ])
  })

  it('sends Authorization, stream:true, and the request body to the endpoint', async () => {
    const fetchMock = stubFetch(sseStream('data: [DONE]\n'))
    const provider = createDeepSeekLlmProvider({ apiKey: 'sk-secret' })
    await collect(
      provider.streamCompletion({
        model: 'deepseek-v4-pro',
        messages: [{ role: 'user', content: 'ask' }],
        temperature: 0.3,
      })
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.deepseek.com/v1/chat/completions')
    expect(init?.method).toBe('POST')

    const headers = init?.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sk-secret')
    expect(headers['Content-Type']).toBe('application/json')

    const sentBody = JSON.parse(init?.body as string)
    expect(sentBody.stream).toBe(true)
    expect(sentBody.model).toBe('deepseek-v4-pro')
    expect(sentBody.messages).toEqual([{ role: 'user', content: 'ask' }])
    expect(sentBody.temperature).toBe(0.3)
  })

  it('omits temperature from the body when not provided', async () => {
    const fetchMock = stubFetch(sseStream('data: [DONE]\n'))
    const provider = createDeepSeekLlmProvider({ apiKey: 'sk-test' })
    await collect(provider.streamCompletion(baseRequest))
    const sentBody = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)
    expect('temperature' in sentBody).toBe(false)
  })

  it('uses the configured baseUrl (trailing slash trimmed)', async () => {
    const fetchMock = stubFetch(sseStream('data: [DONE]\n'))
    const provider = createDeepSeekLlmProvider({
      apiKey: 'sk-test',
      baseUrl: 'https://proxy.example.com/v1/',
    })
    await collect(provider.streamCompletion(baseRequest))
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://proxy.example.com/v1/chat/completions')
  })

  it('falls back to the configured default model when the request omits one', async () => {
    const fetchMock = stubFetch(sseStream('data: [DONE]\n'))
    const provider = createDeepSeekLlmProvider({
      apiKey: 'sk-test',
      model: 'deepseek-v4-flash',
    })
    await collect(provider.streamCompletion({ model: '', messages: baseRequest.messages }))
    const sentBody = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)
    expect(sentBody.model).toBe('deepseek-v4-flash')
  })

  it('throws a descriptive error on a non-2xx response', async () => {
    stubFetch(sseStream('rate limited'), {
      status: 429,
      statusText: 'Too Many Requests',
    })
    const provider = createDeepSeekLlmProvider({ apiKey: 'sk-test' })
    await expect(collect(provider.streamCompletion(baseRequest))).rejects.toThrow(
      /deepseek: chat completions request failed with 429/
    )
  })

  it('exposes lastUsage after the stream is fully consumed', async () => {
    const usageLine = `data: ${JSON.stringify({
      choices: [],
      usage: { prompt_tokens: 11, completion_tokens: 22 },
    })}\n`
    stubFetch(sseStream(deltaLine('hi'), usageLine, 'data: [DONE]\n'))
    const provider = createDeepSeekLlmProvider({ apiKey: 'sk-test' })
    await collect(provider.streamCompletion(baseRequest))
    expect(provider.lastUsage).toEqual({ inputTokens: 11, outputTokens: 22 })
  })
})

// --- connect timeout: hung fetch must fail loud, not park forever ------------

describe('createDeepSeekLlmProvider — connect timeout', () => {
  /**
   * Stub `fetch` with one that hangs until its `AbortSignal` aborts, then
   * rejects (real `fetch` semantics: aborting an in-flight request rejects it).
   * This models a provider that accepts the socket but never returns the
   * response headers — the exact hung-fetch gap the connect deadline closes.
   */
  function stubHangingFetch(): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn((_url: string, init?: RequestInit): Promise<Response> => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        if (!signal) return
        signal.addEventListener('abort', () => {
          // `signal.reason` carries the connect-timeout Error the adapter passed
          // to `controller.abort(...)`.
          reject(signal.reason ?? new DOMException('aborted', 'AbortError'))
        })
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('aborts a hung fetch after the connect deadline and throws (fail loud)', async () => {
    vi.useFakeTimers()
    try {
      stubHangingFetch()
      const provider = createDeepSeekLlmProvider({ apiKey: 'sk-test' })
      const consumed = collect(provider.streamCompletion(baseRequest))
      // Surface the rejection assertion before firing the timer so the rejection
      // is awaited (no unhandled-rejection noise).
      const assertion = expect(consumed).rejects.toThrow(/deepseek: connect timed out/)
      // Before the deadline nothing settles; advancing past it aborts the fetch.
      await vi.advanceTimersByTimeAsync(TIMEOUTS.connectMs)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })

  it('passes the AbortController signal into fetch', async () => {
    const fetchMock = stubFetch(sseStream('data: [DONE]\n'))
    const provider = createDeepSeekLlmProvider({ apiKey: 'sk-test' })
    await collect(provider.streamCompletion(baseRequest))
    const [, init] = fetchMock.mock.calls[0]
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('does NOT kill a slow-but-valid response that streams for a long time', async () => {
    // The timeout bounds the CONNECT phase only: once `fetch` resolves with the
    // response, the deadline is cleared and the streaming body is unbounded. Model
    // a body whose deltas arrive across a long span (well past connectMs of fake
    // time) — every delta must still be delivered, none killed by the timer.
    vi.useFakeTimers()
    try {
      const encoder = new TextEncoder()
      const slowStream = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(encoder.encode(deltaLine('slow ')))
          // A long pause AFTER the first byte — longer than every deadline. A
          // whole-turn timeout would wrongly kill the stream here; a connect /
          // first-response timeout must not.
          await vi.advanceTimersByTimeAsync(TIMEOUTS.connectMs + TIMEOUTS.firstResponseMs + 5000)
          controller.enqueue(encoder.encode(deltaLine('tail')))
          controller.enqueue(encoder.encode('data: [DONE]\n'))
          controller.close()
        },
      })
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: string, _init?: RequestInit) => new Response(slowStream))
      )
      const provider = createDeepSeekLlmProvider({ apiKey: 'sk-test' })
      const chunks = await collect(provider.streamCompletion(baseRequest))
      expect(chunks).toEqual([
        { content: 'slow ', done: false },
        { content: 'tail', done: false },
        { content: '', done: true },
      ])
    } finally {
      vi.useRealTimers()
    }
  })
})
