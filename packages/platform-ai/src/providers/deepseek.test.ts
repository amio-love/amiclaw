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

  it('does NOT kill a long but live stream — each inter-chunk gap stays under the idle window', async () => {
    // Streaming is bounded by the per-chunk idle deadline, NOT by the connect /
    // first-response deadlines: once `fetch` resolves, those are cleared. A stream
    // that keeps producing — with each gap comfortably under the idle window —
    // must run to completion no matter how long its TOTAL duration is, because the
    // idle deadline RESETS on every chunk. It bounds a stall, never a long answer.
    // (Contrast the park test below, where the body goes silent after one delta.)
    const encoder = new TextEncoder()
    const streamIdleMs = 200
    const gapMs = streamIdleMs / 2
    const liveStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode(deltaLine('one ')))
        for (const word of ['two ', 'three ', 'four']) {
          await new Promise((resolve) => setTimeout(resolve, gapMs))
          controller.enqueue(encoder.encode(deltaLine(word)))
        }
        controller.enqueue(encoder.encode('data: [DONE]\n'))
        controller.close()
      },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, _init?: RequestInit) => new Response(liveStream))
    )
    const provider = createDeepSeekLlmProvider({ apiKey: 'sk-test', streamIdleMs })
    const chunks = await collect(provider.streamCompletion(baseRequest))
    expect(chunks).toEqual([
      { content: 'one ', done: false },
      { content: 'two ', done: false },
      { content: 'three ', done: false },
      { content: 'four', done: false },
      { content: '', done: true },
    ])
  })
})

// --- streaming idle timeout: a stream that parks after its first delta must
//     fail loud, not hang the turn forever (the bug this change fixes) -----------

describe('createDeepSeekLlmProvider — streaming idle timeout', () => {
  /**
   * Build a body that emits exactly one content delta and then goes permanently
   * silent: it never enqueues again and never closes. This is the faithful
   * reproduction of the observed park — DeepSeek returns 200 + a first delta,
   * then the SSE stream stalls. The first `reader.read()` resolves the delta; the
   * second parks forever. Without the inter-chunk idle deadline, consuming this
   * stream hangs indefinitely (the bug); with it, the read loses the race to the
   * deadline and the provider throws.
   */
  function parkAfterFirstDelta(): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder()
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(deltaLine('first ')))
        // Deliberately no further enqueue and no close() — the park.
      },
    })
  }

  it('aborts a stream that goes silent after the first delta and throws (fail loud, bounded)', async () => {
    stubFetch(parkAfterFirstDelta())
    const provider = createDeepSeekLlmProvider({ apiKey: 'sk-test', streamIdleMs: 40 })
    const start = performance.now()
    // The first delta surfaces, then consumption rejects within the idle window —
    // it must NOT hang to the test timeout.
    await expect(collect(provider.streamCompletion(baseRequest))).rejects.toThrow(
      /deepseek: SSE stream idle for >40ms after first response/
    )
    expect(performance.now() - start).toBeLessThan(2000)
  })
})

describe('createDeepSeekLlmProvider — caller cancellation', () => {
  it('propagates the request signal through fetch and cancels a pending SSE read', async () => {
    const encoder = new TextEncoder()
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(deltaLine('first ')))
      },
      cancel() {
        cancelled = true
      },
    })
    const fetchMock = stubFetch(body)
    const provider = createDeepSeekLlmProvider({ apiKey: 'sk-test', streamIdleMs: 60_000 })
    const controller = new AbortController()
    const iterator = provider
      .streamCompletion({ ...baseRequest, signal: controller.signal })
      [Symbol.asyncIterator]()

    expect((await iterator.next()).value).toEqual({ content: 'first ', done: false })
    const parked = iterator.next()
    controller.abort(new Error('caller cancelled'))
    await expect(parked).rejects.toThrow('caller cancelled')

    const [, init] = fetchMock.mock.calls[0]
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    expect((init?.signal as AbortSignal).aborted).toBe(true)
    expect(cancelled).toBe(true)
  })
})

// --- sseStreamToChunks idle deadline (direct, controlled differential) ---------

describe('sseStreamToChunks — idle deadline', () => {
  it('rejects when the stream stalls past idleMs after a delta', async () => {
    const encoder = new TextEncoder()
    const stalling = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(deltaLine('hi ')))
        // never enqueue again, never close
      },
    })
    const consume = async (): Promise<LlmCompletionChunk[]> => {
      const out: LlmCompletionChunk[] = []
      for await (const chunk of sseStreamToChunks(stalling, undefined, 40)) out.push(chunk)
      return out
    }
    const start = performance.now()
    await expect(consume()).rejects.toThrow(/SSE stream idle for >40ms/)
    expect(performance.now() - start).toBeLessThan(2000)
  })

  it('WITHOUT an idle bound, a stalled stream does NOT settle (the park this guards, reproduced)', async () => {
    // The other half of the controlled differential: the SAME first-delta-then-
    // silence stream, consumed WITHOUT an idle bound, must NOT settle — that hang
    // is the bug. We prove it behaviorally without letting the test itself park:
    // drive the iterator by hand, race the stalled read against a short sentinel
    // (the sentinel must win = it did not settle), then close the stream so the
    // pending read resolves and the generator's cleanup runs and the test exits.
    const encoder = new TextEncoder()
    let streamController!: ReadableStreamDefaultController<Uint8Array>
    const stalling = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller
        controller.enqueue(encoder.encode(deltaLine('hi ')))
        // never enqueue again, never close — until the test releases it below
      },
    })
    const iterator = sseStreamToChunks(stalling)[Symbol.asyncIterator]() // no idleMs
    expect((await iterator.next()).value).toEqual({ content: 'hi ', done: false })

    // The next read parks: no further bytes, no close, and no idle guard.
    const parkedNext = iterator.next()
    const sentinel = Symbol('sentinel')
    const winner = await Promise.race([
      parkedNext.then(() => 'settled' as const),
      new Promise<typeof sentinel>((resolve) => setTimeout(() => resolve(sentinel), 100)),
    ])
    expect(winner).toBe(sentinel) // did not settle within the window => parked (the bug)

    // Release the park so the test exits cleanly: closing the stream resolves the
    // pending read, the generator emits its terminal chunk, and cleanup runs.
    streamController.close()
    expect(await parkedNext).toEqual({ value: { content: '', done: true }, done: false })
    await iterator.return?.(undefined)
  })

  it('does not arm an idle deadline when idleMs is omitted (pure parsing path unchanged)', async () => {
    const stream = sseStream(deltaLine('a'), 'data: [DONE]\n')
    const chunks = await collect(sseStreamToChunks(stream))
    expect(chunks).toEqual([
      { content: 'a', done: false },
      { content: '', done: true },
    ])
  })
})
