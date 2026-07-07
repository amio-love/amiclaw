// Manual YAML schema — TypeScript mirror of yijing-oracle-design.md §卦辞手册结构.
// Single source of truth for the YAML shape consumed by oracle-ai-engine + game-yijing.
//
// `data.ts` provides the full 64-hexagram base manual against this schema
// (hexagram content in `hexagrams/`). Still open for a later phase:
// curated projection image catalog + daily-manual derivation.

export interface ManualMetadata {
  type: 'yijing-oracle'
  version: string
  /** ISO date — present on per-day manuals, absent on the base manual. */
  date?: string
  total_hexagrams: number
  total_lines: number
}

/** Six psychological dimensions the projection images map onto. */
export interface ProjectionDimensions {
  relationship?: number
  career?: number
  identity?: number
  health?: number
  finance?: number
  growth?: number
}

export interface ProjectionImage {
  /** Stable image id, e.g. `img_014`. */
  id: string
  url: string
  dimensions: ProjectionDimensions
  /** Phase-1 only — references one of the six built-in `ProjArt` SVG glyphs
   *  (`'a'..'f'`) so the renderer can route to the inline component instead
   *  of fetching `url`. Production data sets `url` to a curated asset path
   *  and omits this field. */
  placeholder_ref?: 'a' | 'b' | 'c' | 'd' | 'e' | 'f'
}

export interface HexagramName {
  chinese: string
  pinyin: string
  english: string
}

export interface HexagramTrigrams {
  /** e.g. `'乾 (天)'`. */
  upper: string
  lower: string
}

export interface HexagramJudgment {
  classical: string
  modern_interpretation: string
  keywords: string[]
}

export interface HexagramImage {
  classical: string
  modern_interpretation: string
}

/** A single yao entry — one of the six positioned lines. 用九 / 用六 live in
 *  `HexagramEntry.extra_line`, not here. */
export interface HexagramLine {
  /** Bottom-up position, 1..6. */
  position: 1 | 2 | 3 | 4 | 5 | 6
  /** Chinese line name, e.g. `初九`, `九二`, ..., `上九` / `上六`. */
  name: string
  classical: string
  modern_interpretation: string
  changing_guidance: string
}

/** 乾/坤-only special line (用九 / 用六). Canonical reading rule: when a cast
 *  in 乾 or 坤 has ALL SIX lines changing, the reading uses this text in
 *  place of the six individual 爻辞. */
export interface HexagramExtraLine {
  label: '用九' | '用六'
  classical: string
  modern_interpretation: string
  changing_guidance: string
}

export interface HexagramRelationships {
  /** Opposite (错卦) hexagram number, 1..64. */
  opposite?: number
  /** Nuclear (互卦) upper trigram hexagram number. */
  nuclear_upper?: number
  /** Nuclear (互卦) lower trigram hexagram number. */
  nuclear_lower?: number
}

export interface HexagramEntry {
  /** King Wen number, 1..64. */
  number: number
  name: HexagramName
  trigrams: HexagramTrigrams
  judgment: HexagramJudgment
  image: HexagramImage
  /** Six entries, ordered by `position` 1..6. */
  lines: HexagramLine[]
  /** Present only on 乾 #1 (用九) and 坤 #2 (用六). */
  extra_line?: HexagramExtraLine
  relationships?: HexagramRelationships
}

/** Coin-toss → yao value lookup used by the casting engine. */
export interface CastingGuideValues {
  three_heads: { value: 9; line_type: 'old_yang'; changing: true }
  two_heads_one_tail: { value: 8; line_type: 'young_yin'; changing: false }
  one_head_two_tails: { value: 7; line_type: 'young_yang'; changing: false }
  three_tails: { value: 6; line_type: 'old_yin'; changing: true }
}

export interface CastingGuide {
  method: 'three-coin'
  values: CastingGuideValues
  /** Ordered prose interpretation steps — Phase-2 oracle-ai-engine contract.
   *  Unconsumed by the current no-AI flow: PageReading hardcodes its own
   *  stage order (卦辞+卦象 → 变爻 → 变卦), which happens to match. */
  interpretation_order: string[]
}

export interface ProjectionGuide {
  /** Multi-paragraph image-signal fusion instruction — Phase-2
   *  oracle-ai-engine contract; unconsumed while the flow makes no AI calls. */
  instruction: string
  dimension_labels: {
    relationship: string
    career: string
    identity: string
    health: string
    finance: string
    growth: string
  }
}

export interface Manual {
  metadata: ManualMetadata
  projection_images: ProjectionImage[]
  hexagrams: HexagramEntry[]
  casting_guide: CastingGuide
  projection_guide: ProjectionGuide
}
