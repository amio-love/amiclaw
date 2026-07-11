import { describe, expect, it } from 'vitest'

import { classifyStrategyCommand } from './strategy-command'

describe('explicit Chinese strategy command classifier', () => {
  it.each([
    ['伙伴，过来接应。', 'support'],
    ['请保持接应', 'support'],
    ['靠近我！', 'support'],
    ['去光核探路', 'scout'],
    ['去探路', 'scout'],
    ['去光核附近站位', 'scout'],
    ['去远处架点', 'anchor'],
    ['建立换位点', 'anchor'],
    ['拉开距离！', 'anchor'],
  ] as const)('accepts %s as %s', (text, intent) => {
    expect(classifyStrategyCommand(text)).toEqual({ kind: 'command', intent })
  })

  it.each([
    '不要去光核探路',
    '我不需要你靠近我',
    '别去远处架点',
    '如果我们拉开距离呢',
    '伙伴说“过来接应”',
    '去光核探路然后远处架点',
    '',
    '过来接应\u0007',
    '跟'.repeat(80),
  ])('rejects negated, hypothetical, ambiguous, or unsafe text: %s', (text) => {
    expect(classifyStrategyCommand(text).kind).toBe('clarify')
  })
})
