import type { CompanionIntent } from '../engine/types'

const MAX_COMMAND_CODEPOINTS = 64
const NEGATION_OR_HYPOTHETICAL = /不|别|如果|假如|要是|是否|建议|[吗呢？?]|["“”「」『』]/

const FAMILIES: Array<{ intent: CompanionIntent; patterns: RegExp[] }> = [
  { intent: 'follow', patterns: [/跟着我/, /跟随我/, /跟我走/] },
  { intent: 'split', patterns: [/分头行动/, /我们分头/, /分开走/] },
  { intent: 'decoy', patterns: [/去诱敌/, /吸引追兵/, /把追兵引开/] },
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
