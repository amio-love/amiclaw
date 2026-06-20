/**
 * DeepSeek v4 LLM adapter — the default OpenAI-compatible chat-completions
 * provider for the platform's LLM layer.
 *
 * DeepSeek exposes an OpenAI-compatible chat-completions endpoint. With
 * `stream: true` the response is a `text/event-stream`: one `data: {json}` line
 * per delta, where the incremental assistant text is `choices[0].delta.content`,
 * and the stream terminates with a `data: [DONE]` sentinel. This adapter maps
 * that wire format onto the layer's `LlmProvider` contract.
 *
 * The SSE parsing is factored into pure functions (`parseSseLine`,
 * `sseStreamToChunks`) so the byte-level decoding logic is unit-testable with a
 * constructed `ReadableStream` and no network. `createDeepSeekLlmProvider` is
 * the thin networking shell: it builds the request, asserts a 2xx response, and
 * hands the body stream to the pure parser.
 *
 * Security: `apiKey` is server-side only. It is read from `opts` (which the
 * caller sources from a Worker env binding) and placed in the `Authorization`
 * header — never hardcoded, never sent to or held by the browser.
 */

import type {
  ChatMessage,
  LlmCompletionChunk,
  LlmCompletionRequest,
  LlmProvider,
  LlmUsage,
} from './types'
import { startDeadline, TIMEOUTS } from './timeout'

/** Default DeepSeek OpenAI-compatible base URL (includes the `/v1` prefix). */
const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1'

/** ASCII code point for `/`, used by the linear trailing-slash trim. */
const SLASH_CODE = 0x2f

/**
 * Strip any run of trailing `/` from a base URL. A single linear backward scan,
 * deliberately NOT a regex: the equivalent `/\/+$/` pattern backtracks
 * polynomially on a long run of slashes that fails the end-anchor (a
 * `js/polynomial-redos` shape), so on an adversarial input it can stall the
 * isolate. The character walk is O(n) with no backtracking and yields the
 * identical result. Pure and total.
 */
export function trimTrailingSlashes(value: string): string {
  let end = value.length
  while (end > 0 && value.charCodeAt(end - 1) === SLASH_CODE) end -= 1
  return value.slice(0, end)
}

/** Options for constructing a DeepSeek LLM provider. */
export interface DeepSeekProviderOptions {
  /** Server-side API key, placed in the `Authorization: Bearer` header. */
  apiKey: string
  /**
   * Override the API base URL. Defaults to `https://api.deepseek.com/v1`.
   * A trailing slash is tolerated and trimmed.
   */
  baseUrl?: string
  /**
   * Default model id (e.g. 'deepseek-v4-flash'), supplied by the caller from
   * the resolved `LayerSelection.model`. A model on the per-request
   * `LlmCompletionRequest` takes precedence when present.
   */
  model?: string
}

/**
 * A DeepSeek provider instance. Extends `LlmProvider` with an optional
 * `lastUsage` field: when the vendor reports token usage on the final stream
 * chunk, it is captured here after the stream is fully consumed. Usage is kept
 * off the per-token chunk stream so the hot path stays text-only.
 */
export interface DeepSeekLlmProvider extends LlmProvider {
  /** Token usage from the most recently consumed completion, if reported. */
  lastUsage?: LlmUsage
}

/**
 * Wire shape of one streamed completion chunk's `usage` object (present only on
 * the final chunk, and only when usage reporting is enabled).
 */
interface DeepSeekUsage {
  prompt_tokens?: number
  completion_tokens?: number
}

/** Wire shape of one parsed SSE `data:` JSON payload we care about. */
interface DeepSeekStreamPayload {
  choices?: Array<{ delta?: { content?: string | null } }>
  usage?: DeepSeekUsage | null
}

/**
 * One parsed SSE line. The parser maps a raw line to a discriminated event the
 * stream driver acts on:
 *  - `delta`: a non-empty incremental content fragment to yield
 *  - `usage`: a usage report to record on the provider (not yielded)
 *  - `done`: the `[DONE]` sentinel — emit the terminal `done` chunk
 *  - `ignore`: a blank line, a comment, a non-`data:` line, a role-only/empty
 *    delta, or an unparseable payload — produce nothing
 */
export type SseEvent =
  | { type: 'delta'; content: string }
  | { type: 'usage'; usage: LlmUsage }
  | { type: 'done' }
  | { type: 'ignore' }

/**
 * Parse a single SSE line into an {@link SseEvent}. Pure and total: every input
 * maps to exactly one event, and malformed JSON is treated as `ignore` rather
 * than throwing, so one bad line cannot abort an otherwise valid stream.
 */
export function parseSseLine(line: string): SseEvent {
  const trimmed = line.trim()

  // Blank separators and SSE comment lines carry no payload.
  if (trimmed === '' || trimmed.startsWith(':')) return { type: 'ignore' }

  // Only `data:` lines carry chunk payloads; event/id/retry fields are ignored.
  if (!trimmed.startsWith('data:')) return { type: 'ignore' }

  const data = trimmed.slice('data:'.length).trim()
  if (data === '[DONE]') return { type: 'done' }

  let payload: DeepSeekStreamPayload
  try {
    payload = JSON.parse(data) as DeepSeekStreamPayload
  } catch {
    return { type: 'ignore' }
  }

  // Usage (final chunk only, when enabled) is recorded, not streamed as text.
  if (payload.usage) {
    return {
      type: 'usage',
      usage: {
        inputTokens: payload.usage.prompt_tokens ?? 0,
        outputTokens: payload.usage.completion_tokens ?? 0,
      },
    }
  }

  // The role-only first chunk and any keep-alive chunk carry no content; skip.
  const content = payload.choices?.[0]?.delta?.content
  if (typeof content === 'string' && content.length > 0) {
    return { type: 'delta', content }
  }

  return { type: 'ignore' }
}

/**
 * Convert a DeepSeek SSE byte stream into the layer's chunk stream. Pure with
 * respect to the network: it only decodes and parses the given
 * `ReadableStream`, so it is fully unit-testable against a constructed stream.
 *
 * Yields one `{ content, done: false }` chunk per non-empty content delta, then
 * a single terminal `{ content: '', done: true }` chunk. The terminal chunk is
 * emitted exactly once — at the `[DONE]` sentinel, or, if the stream ends
 * without one, when the body closes — so consumers always observe a clean end.
 *
 * `onUsage` is invoked if the vendor reports token usage on the final chunk.
 */
export async function* sseStreamToChunks(
  stream: ReadableStream<Uint8Array>,
  onUsage?: (usage: LlmUsage) => void
): AsyncIterable<LlmCompletionChunk> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let doneEmitted = false

  try {
    for (;;) {
      const { done, value } = await reader.read()

      if (value !== undefined) buffer += decoder.decode(value, { stream: true })

      if (done) {
        // Flush any trailing bytes, then process whatever remains as a last line.
        buffer += decoder.decode()
        const trailing = processSse(buffer, onUsage)
        for (const chunk of trailing.chunks) yield chunk
        if (trailing.done && !doneEmitted) {
          doneEmitted = true
          yield { content: '', done: true }
        }
        break
      }

      // Process whole lines; keep the unterminated remainder in the buffer.
      const newlineIdx = buffer.lastIndexOf('\n')
      if (newlineIdx === -1) continue

      const ready = buffer.slice(0, newlineIdx)
      buffer = buffer.slice(newlineIdx + 1)

      const processed = processSse(ready, onUsage)
      for (const chunk of processed.chunks) yield chunk
      if (processed.done && !doneEmitted) {
        doneEmitted = true
        yield { content: '', done: true }
        // `[DONE]` is the logical end; stop reading further bytes.
        return
      }
    }
  } finally {
    reader.releaseLock()
  }

  // Stream closed without an explicit `[DONE]` — still give consumers a clean
  // terminal chunk so the contract's `done` guarantee holds.
  if (!doneEmitted) yield { content: '', done: true }
}

/**
 * Parse a block of complete SSE lines into ready chunks plus a `done` flag.
 * Side effects (usage recording) are pushed through `onUsage`; content deltas
 * become chunks. Splitting this out keeps {@link sseStreamToChunks} focused on
 * buffering and termination bookkeeping.
 */
function processSse(
  block: string,
  onUsage?: (usage: LlmUsage) => void
): { chunks: LlmCompletionChunk[]; done: boolean } {
  const chunks: LlmCompletionChunk[] = []
  let done = false

  for (const line of block.split('\n')) {
    const event = parseSseLine(line)
    switch (event.type) {
      case 'delta':
        chunks.push({ content: event.content, done: false })
        break
      case 'usage':
        onUsage?.(event.usage)
        break
      case 'done':
        done = true
        break
      case 'ignore':
        break
    }
    if (done) break
  }

  return { chunks, done }
}

/**
 * Create a DeepSeek v4 LLM provider implementing the OpenAI-compatible,
 * streaming `LlmProvider` contract.
 */
export function createDeepSeekLlmProvider(opts: DeepSeekProviderOptions): DeepSeekLlmProvider {
  const baseUrl = trimTrailingSlashes(opts.baseUrl ?? DEFAULT_BASE_URL)
  const endpoint = `${baseUrl}/chat/completions`

  const provider: DeepSeekLlmProvider = {
    async *streamCompletion(request: LlmCompletionRequest): AsyncIterable<LlmCompletionChunk> {
      const model = request.model || opts.model
      if (!model) {
        throw new Error(
          'deepseek: no model specified (set DeepSeekProviderOptions.model or LlmCompletionRequest.model)'
        )
      }

      const body: {
        model: string
        messages: ChatMessage[]
        stream: true
        stream_options: { include_usage: true }
        temperature?: number
      } = {
        model,
        messages: request.messages,
        stream: true,
        // Ask the vendor to report token usage on the final chunk so `lastUsage`
        // can be populated without a separate metering call.
        stream_options: { include_usage: true },
      }
      if (request.temperature !== undefined) body.temperature = request.temperature

      // Connect / first-response timeout: a `fetch` POST can hang indefinitely
      // before the response headers arrive (DNS, TLS, or a server that accepts
      // the socket then never responds), with no error and no first byte. An
      // `AbortController` + connect deadline bounds exactly that window: if the
      // headers do not arrive in time the controller aborts, `fetch` rejects, and
      // the turn fails loud instead of parking forever. The deadline is cleared
      // the instant `fetch` resolves — the SSE body stream that follows is the
      // model's (legitimately long) streaming output and is NOT timer-bound.
      const connectController = new AbortController()
      const connectDeadline = startDeadline(TIMEOUTS.connectMs, () =>
        connectController.abort(
          new Error(`deepseek: connect timed out after ${TIMEOUTS.connectMs}ms`)
        )
      )
      let response: Response
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${opts.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: connectController.signal,
        })
      } finally {
        // Headers arrived (or the fetch failed / aborted) — stop the timer either
        // way so the streaming phase runs with no deadline and no dangling handle.
        connectDeadline.cancel()
      }

      if (!response.ok) {
        const detail = await safeReadText(response)
        throw new Error(
          `deepseek: chat completions request failed with ${response.status} ${response.statusText}${
            detail ? `: ${detail}` : ''
          }`
        )
      }

      if (response.body === null) {
        throw new Error('deepseek: response had no body to stream')
      }

      // Reset before consuming so a half-consumed prior stream cannot leak a
      // stale usage value into this completion.
      provider.lastUsage = undefined
      yield* sseStreamToChunks(response.body, (usage) => {
        provider.lastUsage = usage
      })
    },
  }

  return provider
}

/** Read an error response body for diagnostics; never throw while doing so. */
async function safeReadText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500)
  } catch {
    return ''
  }
}
