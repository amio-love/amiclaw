import type { CompanionIntent } from '../engine/types'

const MAX_COMMAND_CODEPOINTS = 64
const NEGATION_OR_HYPOTHETICAL = /不|别|如果|假如|要是|是否|建议|[吗呢？?]|["“”「」『』]/

const FAMILIES: Array<{ intent: CompanionIntent; patterns: RegExp[] }> = [
  { intent: 'support', patterns: [/过来接应/, /保持接应/, /靠近我/] },
  { intent: 'scout', patterns: [/去光核探路/, /去探路/, /光核附近站位/] },
  { intent: 'anchor', patterns: [/远处架点/, /建立换位点/, /拉开距离/] },
]

export type StrategyCommandResult =
  | { kind: 'command'; intent: CompanionIntent }
  | { kind: 'clarify'; reason: 'empty' | 'unsafe' | 'negated' | 'ambiguous' | 'unknown' }

export function classifyStrategyCommand(text: string): StrategyCommandResult {
  const trimmed = text.trim()
  if (!trimmed) return { kind: 'clarify', reason: 'empty' }
  const hasControlCharacter = [...trimmed].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159)
  })
  if ([...trimmed].length > MAX_COMMAND_CODEPOINTS || hasControlCharacter) {
    return { kind: 'clarify', reason: 'unsafe' }
  }
  if (NEGATION_OR_HYPOTHETICAL.test(trimmed)) return { kind: 'clarify', reason: 'negated' }
  const matches = FAMILIES.filter((family) =>
    family.patterns.some((pattern) => pattern.test(trimmed))
  )
  if (matches.length > 1) return { kind: 'clarify', reason: 'ambiguous' }
  if (matches.length === 0) return { kind: 'clarify', reason: 'unknown' }
  return { kind: 'command', intent: matches[0].intent }
}
