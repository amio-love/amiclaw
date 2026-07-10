import { describe, expect, it } from 'vitest'

import { replay, replayDigest } from './replay'
import { runIdForSeed } from './rules'
import type { ReplayRecord } from './types'

const RECORD: ReplayRecord = {
  schemaVersion: 1,
  seed: 91,
  mapId: 'courtyard',
  difficulty: 'standard',
  actions: [
    { applyAtTick: 1, sequence: 1, action: { type: 'player-move', direction: 'right' } },
    { applyAtTick: 2, sequence: 2, action: { type: 'companion-command', command: 'split' } },
    { applyAtTick: 3, sequence: 3, action: { type: 'swap' } },
  ],
}

describe('replay determinism', () => {
  it('survives repetition and JSON round trips', () => {
    const first = replay(RECORD, 32)
    const second = replay(JSON.parse(JSON.stringify(RECORD)) as ReplayRecord, 32)
    expect(second).toEqual(first)
    expect(replayDigest(second)).toBe(replayDigest(first))
  })

  it('never consults a model because accepted proposals are recorded actions', () => {
    const withLease: ReplayRecord = {
      ...RECORD,
      actions: [
        {
          applyAtTick: 1,
          sequence: 1,
          action: {
            type: 'accept-model-proposal',
            requestId: '00000000-0000-4000-8000-000000000001',
            runId: runIdForSeed(RECORD.seed),
            decisionEpoch: 0,
            proposal: { intent: 'decoy', bark: 'I will draw it away.' },
            leaseTicks: 8,
          },
        },
      ],
    }
    expect(replay(withLease, 4).activeModelLease?.intent).toBe('decoy')
  })
})
