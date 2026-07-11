import { describe, expect, it, vi } from 'vitest'

import { createIntentCoordinator } from './intent-client'
import type { IntentRequest, IntentResponse } from './intent-contract'

function request(epoch: number): IntentRequest {
  return {
    version: 1,
    requestId: `00000000-0000-4000-8000-${String(epoch).padStart(12, '0')}`,
    runId: '00000000-0000-4000-8000-000000000009',
    decisionEpoch: epoch,
    observedTick: epoch,
    difficulty: 'standard',
    command: 'support',
    actors: [],
    pursuer: { x: 1, y: 1 },
    objectives: [],
    exit: { x: 1, y: 1 },
    swapCharges: 0,
    allowedIntents: ['support', 'scout', 'anchor'],
  }
}

describe('one-in-flight intent coordinator', () => {
  it('deduplicates an epoch and aborts it for a newer epoch', async () => {
    const signals: AbortSignal[] = []
    const fetchIntent = vi.fn(
      (_request: IntentRequest, signal: AbortSignal) =>
        new Promise<IntentResponse>(() => {
          signals.push(signal)
        })
    )
    const accepted = vi.fn()
    const coordinator = createIntentCoordinator({ fetchIntent, onAccepted: accepted })
    coordinator.request(request(1), { generation: 1, runId: request(1).runId, decisionEpoch: 1 })
    coordinator.request(request(1), { generation: 1, runId: request(1).runId, decisionEpoch: 1 })
    expect(fetchIntent).toHaveBeenCalledTimes(1)
    coordinator.request(request(2), { generation: 1, runId: request(2).runId, decisionEpoch: 2 })
    expect(signals[0].aborted).toBe(true)
    expect(fetchIntent).toHaveBeenCalledTimes(2)
  })

  it('discards a cross-generation late response', async () => {
    let resolve!: (response: IntentResponse) => void
    const fetchIntent = () =>
      new Promise<IntentResponse>((done) => {
        resolve = done
      })
    const accepted = vi.fn()
    const coordinator = createIntentCoordinator({ fetchIntent, onAccepted: accepted })
    const value = request(1)
    coordinator.request(value, { generation: 1, runId: value.runId, decisionEpoch: 1 })
    coordinator.dispose()
    resolve({
      version: 1,
      requestId: value.requestId,
      runId: value.runId,
      decisionEpoch: 1,
      proposal: { intent: 'support' },
      leaseTicks: 8,
    })
    await Promise.resolve()
    expect(accepted).not.toHaveBeenCalled()
  })
})
