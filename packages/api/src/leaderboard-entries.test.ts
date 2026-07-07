import { describe, expect, it } from 'vitest'
import { dedupeStoredEntries, type StoredEntry } from './leaderboard-entries'

const DEVICE_A = 'aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee'
const DEVICE_B = 'bbbbbbbb-cccc-4ddd-9eee-ffffffffffff'

function entry(overrides: Partial<StoredEntry> = {}): StoredEntry {
  return {
    rank: 0,
    nickname: '小明',
    time_ms: 130_000,
    attempt_number: 1,
    ai_tool: 'claude',
    ...overrides,
  }
}

describe('dedupeStoredEntries — one row per player, best time wins', () => {
  it('keeps only the faster run when the same device submits twice', () => {
    const result = dedupeStoredEntries([
      entry({ device_id: DEVICE_A, time_ms: 150_000, attempt_number: 1 }),
      entry({ device_id: DEVICE_A, time_ms: 130_000, attempt_number: 3 }),
    ])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ rank: 1, time_ms: 130_000, attempt_number: 3 })
  })

  it('keeps the existing best when the same device submits a slower run', () => {
    const result = dedupeStoredEntries([
      entry({ device_id: DEVICE_A, time_ms: 130_000, attempt_number: 1 }),
      entry({ device_id: DEVICE_A, time_ms: 150_000, attempt_number: 2 }),
    ])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ rank: 1, time_ms: 130_000, attempt_number: 1 })
  })

  it('keeps the incumbent on an exact tie (mirrors personal-best strict <)', () => {
    const result = dedupeStoredEntries([
      entry({ device_id: DEVICE_A, time_ms: 130_000, attempt_number: 1 }),
      entry({ device_id: DEVICE_A, time_ms: 130_000, attempt_number: 2 }),
    ])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ attempt_number: 1 })
  })

  it('keeps different devices as separate rows even with the same nickname', () => {
    const result = dedupeStoredEntries([
      entry({ device_id: DEVICE_A, time_ms: 150_000 }),
      entry({ device_id: DEVICE_B, time_ms: 130_000 }),
    ])
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ rank: 1, time_ms: 130_000, device_id: DEVICE_B })
    expect(result[1]).toMatchObject({ rank: 2, time_ms: 150_000, device_id: DEVICE_A })
  })

  it('collapses legacy rows (no device_id) sharing a nickname, keeping the best', () => {
    const result = dedupeStoredEntries([
      entry({ nickname: '审计员07', time_ms: 150_000, attempt_number: 1 }),
      entry({ nickname: '审计员07', time_ms: 130_000, attempt_number: 1 }),
    ])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ rank: 1, nickname: '审计员07', time_ms: 130_000 })
  })

  it('keeps legacy rows with distinct nicknames as separate rows', () => {
    const result = dedupeStoredEntries([
      entry({ nickname: '小明', time_ms: 150_000 }),
      entry({ nickname: '小红', time_ms: 130_000 }),
    ])
    expect(result).toHaveLength(2)
  })

  it('merges a legacy row into a same-nickname device row, keeping the faster device run', () => {
    const result = dedupeStoredEntries([
      entry({ nickname: '小明', time_ms: 150_000 }),
      entry({ nickname: '小明', device_id: DEVICE_A, time_ms: 130_000 }),
    ])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ time_ms: 130_000, device_id: DEVICE_A })
  })

  it('merges a faster legacy row into a same-nickname device row, adopting the device_id', () => {
    const result = dedupeStoredEntries([
      entry({ nickname: '小明', time_ms: 120_000, attempt_number: 2 }),
      entry({ nickname: '小明', device_id: DEVICE_A, time_ms: 130_000, attempt_number: 4 }),
    ])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      time_ms: 120_000,
      attempt_number: 2,
      device_id: DEVICE_A,
    })
  })

  it('re-sorts ascending by time and reassigns contiguous ranks after collapsing', () => {
    const result = dedupeStoredEntries([
      entry({ rank: 1, device_id: DEVICE_A, time_ms: 100_000 }),
      entry({ rank: 2, device_id: DEVICE_A, time_ms: 140_000 }),
      entry({ rank: 3, nickname: '小红', device_id: DEVICE_B, time_ms: 120_000 }),
      entry({ rank: 4, nickname: 'Legacy', time_ms: 110_000 }),
    ])
    expect(result.map((e) => [e.rank, e.time_ms])).toEqual([
      [1, 100_000],
      [2, 110_000],
      [3, 120_000],
    ])
  })
})
