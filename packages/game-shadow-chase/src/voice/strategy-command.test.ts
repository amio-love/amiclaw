import { describe, expect, it } from 'vitest'

import { classifyStrategyCommand } from './strategy-command'

describe('explicit Chinese strategy command classifier', () => {
  it.each([
    ['伙伴，跟着我。', 'follow'],
    ['请跟随我', 'follow'],
    ['跟我走！', 'follow'],
    ['分头行动', 'split'],
    ['我们分头。', 'split'],
    ['分开走', 'split'],
    ['去诱敌', 'decoy'],
    ['请吸引追兵', 'decoy'],
    ['把追兵引开！', 'decoy'],
  ] as const)('accepts %s as %s', (text, intent) => {
    expect(classifyStrategyCommand(text)).toEqual({ kind: 'command', intent })
  })

  it.each([
    '不要分头行动',
    '我不需要你跟着我',
    '别去诱敌',
    '如果我们分开走呢',
    '伙伴说“跟着我”',
    '分头行动然后去诱敌',
    '',
    '跟着我\u0007',
    '跟'.repeat(80),
  ])('rejects negated, hypothetical, ambiguous, or unsafe text: %s', (text) => {
    expect(classifyStrategyCommand(text).kind).toBe('clarify')
  })
})
