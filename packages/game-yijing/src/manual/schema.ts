// Manual YAML schema — TypeScript mirror of yijing-oracle-design.md §卦辞手册结构.
// Single source of truth for the YAML shape consumed by oracle-ai-engine + game-yijing.
//
// Phase 1 (this scaffold): `demo-data.ts` provides one demo hexagram against this schema.
// Phase 2 (sibling 2 / later): full 64-hex YAML, projection image catalog,
// daily-manual derivation, and (probably) a js-yaml loader pipeline.

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

/** A single yao entry (one of the six lines, plus optional 用九 / 用六 in 乾 / 坤). */
export interface HexagramLine {
  /** Bottom-up position, 1..6. */
  position: 1 | 2 | 3 | 4 | 5 | 6
  /** Chinese line name, e.g. `初九`, `九二`, ..., `上九` / `上六`. */
  name: string
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
  /** Ordered prose steps the AI follows when interpreting a cast. */
  interpretation_order: string[]
}

export interface ProjectionGuide {
  /** Multi-paragraph instruction the AI reads when fusing image signals. */
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
