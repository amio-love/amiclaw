import { INTENT_TIMEOUT_MS, parseIntentResponse } from './intent-contract'
import type { IntentRequest, IntentResponse } from './intent-contract'

export interface IntentContext {
  generation: number
  runId: string
  decisionEpoch: number
}

export type IntentFetch = (request: IntentRequest, signal: AbortSignal) => Promise<IntentResponse>

export interface IntentCoordinator {
  request(request: IntentRequest, context: IntentContext): void
  abortCurrent(): void
  dispose(): void
}

export function createIntentCoordinator(options: {
  fetchIntent: IntentFetch
  onAccepted: (response: IntentResponse, context: IntentContext) => void
}): IntentCoordinator {
  let disposed = false
  let active:
    | {
        controller: AbortController
        request: IntentRequest
        context: IntentContext
      }
    | undefined

  const abortCurrent = () => {
    if (!active) return
    active.controller.abort()
    active = undefined
  }

  return {
    request(request, context) {
      if (disposed) return
      if (
        active &&
        active.context.generation === context.generation &&
        active.context.runId === context.runId &&
        active.context.decisionEpoch === context.decisionEpoch
      ) {
        return
      }
      abortCurrent()
      const slot = { controller: new AbortController(), request, context }
      active = slot
      void options
        .fetchIntent(request, slot.controller.signal)
        .then((response) => {
          if (
            disposed ||
            active !== slot ||
            slot.controller.signal.aborted ||
            response.requestId !== request.requestId ||
            response.runId !== context.runId ||
            response.decisionEpoch !== context.decisionEpoch
          ) {
            return
          }
          options.onAccepted(response, context)
        })
        .catch(() => undefined)
        .finally(() => {
          if (active === slot) active = undefined
        })
    },
    abortCurrent,
    dispose() {
      if (disposed) return
      disposed = true
      abortCurrent()
    },
  }
}

export async function fetchIntentFromEndpoint(
  request: IntentRequest,
  signal: AbortSignal
): Promise<IntentResponse> {
  const deadline = new AbortController()
  const timeout = window.setTimeout(() => deadline.abort(), INTENT_TIMEOUT_MS)
  const combined = AbortSignal.any([signal, deadline.signal])
  try {
    const response = await fetch('/ai-intent/shadow-chase', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal: combined,
    })
    if (!response.ok) throw new Error(`Intent request failed: ${response.status}`)
    const result = parseIntentResponse(await response.text())
    if (!result.ok) throw new Error(`Intent response rejected: ${result.reason}`)
    return result.value
  } finally {
    window.clearTimeout(timeout)
  }
}
