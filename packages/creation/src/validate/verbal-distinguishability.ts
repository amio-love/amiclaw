/**
 * verbal_distinguishability — hidden_info_coop floor check (spec Mechanism 3).
 *
 * Archetype layer: pairwise pinyin syllable+tone edit distance between the
 * GameType's canonical verbal labels (phonetic_pinyin is the metric's sole,
 * unambiguous input — it records the platform's chosen colloquial reading).
 * Distance below threshold → WARNING per spec.
 *
 * Instance layer: rendered instance labels — shared_label_attributes values
 * rendered through display_labels + verbal_template — must be unique among
 * same-archetype instances in the level. A rendered collision → ERROR (it
 * blocks voice co-reference outright). This is the rendered-level
 * counterpart of budget_compliance's raw-value uniqueness check, and it
 * catches two distinct raw values whose display labels collide. Phonetic
 * distance at the instance layer needs pinyin for display labels, which the
 * schema does not declare — the spec's Open Questions propose an optional
 * display_label_pinyin map as the unblock; until it settles, v1 implements
 * the exact rendered-collision half only.
 *
 * Metric: syllable is the edit unit (Levenshtein over syllable sequences,
 * insertion/deletion cost 1); a same-base tone-only difference costs 0.4 —
 * tones are extra-weighted as smaller-than-syllable distances, so
 * near-homophones (mì yào / mì yáo → 0.4) land far below a full-syllable
 * change. PROVISIONAL threshold 1.0: two labels must differ by at least one
 * full syllable (a tone-only or zero difference flags). Justified against
 * the radio-cipher vocabulary: its label pairs sit at distance ≥ 2.0.
 * Experimental calibration remains declared design debt (spec Open
 * Questions).
 */

import type { CheckResult, ElementArchetype, GameType, Level, Violation } from '../schema/types'
import { buildCheckResult } from './helpers'

const DISTANCE_THRESHOLD = 1.0
const TONE_SUBSTITUTION_COST = 0.4

const TONE_MARKS: Record<string, [string, number]> = {
  ā: ['a', 1],
  á: ['a', 2],
  ǎ: ['a', 3],
  à: ['a', 4],
  ē: ['e', 1],
  é: ['e', 2],
  ě: ['e', 3],
  è: ['e', 4],
  ī: ['i', 1],
  í: ['i', 2],
  ǐ: ['i', 3],
  ì: ['i', 4],
  ō: ['o', 1],
  ó: ['o', 2],
  ǒ: ['o', 3],
  ò: ['o', 4],
  ū: ['u', 1],
  ú: ['u', 2],
  ǔ: ['u', 3],
  ù: ['u', 4],
  ǖ: ['ü', 1],
  ǘ: ['ü', 2],
  ǚ: ['ü', 3],
  ǜ: ['ü', 4],
}

interface Syllable {
  base: string
  tone: number
}

function parseSyllables(pinyin: string): Syllable[] {
  return pinyin
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((s) => s.length > 0)
    .map(parseSyllable)
}

/**
 * Accepts both tone-marked ("mì") and numeric-tone ("mi4") pinyin forms,
 * normalized to one representation so mixed inputs never silently
 * mis-score (numeric tone 5 means neutral, like 0; "v" normalizes to "ü").
 */
function parseSyllable(raw: string): Syllable {
  let base = ''
  let tone = 0
  for (const char of raw) {
    const marked = TONE_MARKS[char]
    if (marked) {
      base += marked[0]
      tone = marked[1]
    } else {
      base += char
    }
  }
  const numeric = base.match(/^([a-zü]+)([0-5])$/)
  if (numeric) {
    base = numeric[1]
    const digit = Number(numeric[2])
    tone = digit === 5 ? 0 : digit
  }
  return { base: base.replace(/v/g, 'ü'), tone }
}

/**
 * Syllable+tone edit distance between two phonetic_pinyin strings:
 * Levenshtein over syllables; substitution costs 0 (identical), 0.4
 * (same base, different tone), or 1 (different base); ins/del cost 1.
 */
export function pinyinDistance(a: string, b: string): number {
  const sa = parseSyllables(a)
  const sb = parseSyllables(b)
  const rows = sa.length + 1
  const cols = sb.length + 1
  const dp: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0))
  for (let i = 1; i < rows; i++) dp[i][0] = i
  for (let j = 1; j < cols; j++) dp[0][j] = j
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const x = sa[i - 1]
      const y = sb[j - 1]
      const substitution = x.base === y.base ? (x.tone === y.tone ? 0 : TONE_SUBSTITUTION_COST) : 1
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + substitution)
    }
  }
  return dp[rows - 1][cols - 1]
}

export function checkVerbalDistinguishability(gameType: GameType, level: Level): CheckResult {
  const violations: Violation[] = []

  // Archetype layer: pairwise canonical-label distance over the vocabulary.
  const archetypes = gameType.element_archetypes
  for (let i = 0; i < archetypes.length; i++) {
    for (let j = i + 1; j < archetypes.length; j++) {
      const a = archetypes[i].verbal_label
      const b = archetypes[j].verbal_label
      const distance = pinyinDistance(a.phonetic_pinyin, b.phonetic_pinyin)
      if (distance < DISTANCE_THRESHOLD) {
        violations.push({
          severity: 'warning',
          field_path: `game_type.element_archetypes[${j}].verbal_label.phonetic_pinyin`,
          constraint: 'verbal_distance_threshold',
          expected: `syllable+tone edit distance >= ${DISTANCE_THRESHOLD} from "${a.canonical}" (${a.phonetic_pinyin})`,
          actual: `"${b.canonical}" (${b.phonetic_pinyin}) at distance ${distance}`,
          suggestion:
            'Rename one archetype verbal label so the two differ by at least one full syllable',
        })
      }
    }
  }

  // Instance layer: rendered instance labels unique per archetype.
  const archetypeById = new Map(archetypes.map((a) => [a.id, a]))
  const entries = gameType.information_partition_template?.shared_label_attributes ?? []
  for (const entry of entries) {
    const archetype = archetypeById.get(entry.element_archetype)
    if (!archetype) continue // gametype_consistency reports the broken reference
    const seen = new Map<string, string>()
    level.elements.forEach((element, k) => {
      if (element.archetype !== entry.element_archetype) return
      const label = renderInstanceLabel(archetype, entry.attributes, element.params)
      const firstId = seen.get(label)
      if (firstId !== undefined) {
        violations.push({
          severity: 'error',
          field_path: `elements[${k}]`,
          constraint: 'rendered_label_unique',
          expected: `unique rendered instance labels across "${entry.element_archetype}" instances`,
          actual: `"${firstId}" and "${element.id}" both render as "${label}"`,
          suggestion:
            'Choose attribute values whose display labels render distinct instance labels, or add a mutually visible disambiguating attribute',
          related_elements: [firstId, element.id],
        })
      } else {
        seen.set(label, element.id)
      }
    })
  }

  return buildCheckResult('verbal_distinguishability', violations)
}

/**
 * Render an instance label from the shared label attributes: each attribute
 * value maps through display_labels, then through the attribute's
 * verbal_template ("{content_length}密文段" → 短密文段); attributes without a
 * template fall back to display value + canonical label. Multiple attributes
 * concatenate.
 */
function renderInstanceLabel(
  archetype: ElementArchetype,
  attributes: string[],
  params: Record<string, unknown>
): string {
  const pieces = attributes.map((attrName) => {
    const definition = archetype.attributes.find((a) => a.name === attrName)
    const raw = String(params[attrName])
    const display = definition?.display_labels?.[raw] ?? raw
    const template = definition?.verbal_template
    if (template && template.includes(`{${attrName}}`)) {
      return template.replace(`{${attrName}}`, display)
    }
    return `${display}${archetype.verbal_label.canonical}`
  })
  return pieces.join('')
}
