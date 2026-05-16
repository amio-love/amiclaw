import { describe, expect, it } from 'vitest'
import { buildRetroQuestions } from './retro-questions'
import type { ModuleStat } from '@/store/game-context'

function stat(moduleType: string, timeMs: number, errorCount = 0): ModuleStat {
  return { moduleType, timeMs, errorCount }
}

describe('buildRetroQuestions', () => {
  const baseStats: ModuleStat[] = [
    stat('wire', 30_000),
    stat('dial', 105_000), // longest
    stat('button', 38_000),
    stat('keypad', 48_000),
  ]

  it('returns three "- " prefixed lines', () => {
    const out = buildRetroQuestions(baseStats, 1, 'practice')
    const lines = out.split('\n')
    expect(lines).toHaveLength(3)
    for (const line of lines) {
      expect(line.startsWith('- ')).toBe(true)
    }
  })

  it('Q1 names the slowest module by Chinese label (single longest)', () => {
    const out = buildRetroQuestions(baseStats, 1, 'practice')
    const q1 = out.split('\n')[0]
    expect(q1).toContain('密码盘模块耗时最长')
  })

  it('on time ties, Q1 picks the lower-index module (stable)', () => {
    const tied: ModuleStat[] = [
      stat('wire', 60_000), // index 0 — wins tie
      stat('dial', 60_000),
      stat('button', 30_000),
      stat('keypad', 30_000),
    ]
    const out = buildRetroQuestions(tied, 1, 'practice')
    const q1 = out.split('\n')[0]
    expect(q1).toContain('线路模块耗时最长')
    expect(q1).not.toContain('密码盘模块耗时最长')
  })

  it('Q1 omits reset count when errorCount is 0', () => {
    const out = buildRetroQuestions(baseStats, 1, 'practice')
    const q1 = out.split('\n')[0]
    expect(q1).toContain('耗时最长')
    expect(q1).not.toContain('重置')
  })

  it('Q1 includes reset count when errorCount >= 1', () => {
    const withReset: ModuleStat[] = [
      stat('wire', 30_000),
      stat('dial', 105_000, 2), // 2 resets
      stat('button', 38_000),
      stat('keypad', 48_000),
    ]
    const out = buildRetroQuestions(withReset, 1, 'practice')
    const q1 = out.split('\n')[0]
    expect(q1).toContain('耗时最长且重置 2 次')
  })

  it('Q2 in daily mode with attemptNumber > 1 references the attempt number', () => {
    const out = buildRetroQuestions(baseStats, 3, 'daily')
    const q2 = out.split('\n')[1]
    expect(q2).toContain('第 3 次')
    expect(q2).toContain('跟前几次比')
  })

  it('Q2 in daily mode with attemptNumber === 1 falls back to the generic question', () => {
    const out = buildRetroQuestions(baseStats, 1, 'daily')
    const q2 = out.split('\n')[1]
    expect(q2).not.toContain('第 1 次')
    expect(q2).toContain('这一局')
  })

  it('Q2 in practice mode uses the generic question regardless of attemptNumber', () => {
    const out = buildRetroQuestions(baseStats, 4, 'practice')
    const q2 = out.split('\n')[1]
    expect(q2).not.toContain('第 4 次')
    expect(q2).toContain('这一局')
  })

  it('Q3 always asks about updating the skills file', () => {
    for (const mode of ['practice', 'daily'] as const) {
      const out = buildRetroQuestions(baseStats, 2, mode)
      const q3 = out.split('\n')[2]
      expect(q3).toContain('skills 文件')
    }
  })

  it('returns empty string when stats is empty', () => {
    expect(buildRetroQuestions([], 1, 'practice')).toBe('')
    expect(buildRetroQuestions([], 3, 'daily')).toBe('')
  })
})
