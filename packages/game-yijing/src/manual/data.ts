// Base manual — full 64-hexagram dataset against `schema.ts`.
//
// Hexagram content lives in `hexagrams/` (8 chunk files, King Wen order):
// classical texts (卦辞 / 大象 / 爻辞) follow the received text (通行本);
// modern glosses / changing guidance / keywords are authored product copy.
//
// `projection_images` is filled with 6 placeholder entries that route to the
// in-codebase `ProjArt` SVG glyphs (`a..f`) via the `placeholder_ref` field
// (schema.ts). Per-image `dimensions` weights mirror the per-id table
// already declared in `glyphs/ProjArt.tsx#PROJ_DIMENSIONS`.

import type { Manual } from './schema'
import { HEXAGRAMS } from './hexagrams'

export const manual: Manual = {
  metadata: {
    type: 'yijing-oracle',
    version: '1.0.0',
    total_hexagrams: 64,
    // 64 × 6 positioned lines + 乾用九 + 坤用六 = 386 classical line texts.
    total_lines: 386,
  },
  // Six Phase-1 placeholder images — render via the in-codebase ProjArt SVG
  // glyphs (`a..f`) routed by `placeholder_ref`. Production swap-in: replace
  // each entry's `url` with a curated asset path and drop `placeholder_ref`.
  projection_images: [
    {
      id: 'img_a',
      url: 'glyph:a',
      placeholder_ref: 'a',
      dimensions: { relationship: 0.35, growth: 0.5, identity: 0.15 },
    },
    {
      id: 'img_b',
      url: 'glyph:b',
      placeholder_ref: 'b',
      dimensions: { career: 0.45, growth: 0.4, relationship: 0.15 },
    },
    {
      id: 'img_c',
      url: 'glyph:c',
      placeholder_ref: 'c',
      dimensions: { identity: 0.5, growth: 0.3, finance: 0.2 },
    },
    {
      id: 'img_d',
      url: 'glyph:d',
      placeholder_ref: 'd',
      dimensions: { relationship: 0.6, identity: 0.25, growth: 0.15 },
    },
    {
      id: 'img_e',
      url: 'glyph:e',
      placeholder_ref: 'e',
      dimensions: { health: 0.4, identity: 0.35, growth: 0.25 },
    },
    {
      id: 'img_f',
      url: 'glyph:f',
      placeholder_ref: 'f',
      dimensions: { career: 0.35, finance: 0.35, growth: 0.3 },
    },
  ],
  hexagrams: HEXAGRAMS,
  casting_guide: {
    method: 'three-coin',
    values: {
      three_heads: { value: 9, line_type: 'old_yang', changing: true },
      two_heads_one_tail: { value: 8, line_type: 'young_yin', changing: false },
      one_head_two_tails: { value: 7, line_type: 'young_yang', changing: false },
      three_tails: { value: 6, line_type: 'old_yin', changing: true },
    },
    interpretation_order: [
      '先读本卦卦辞（judgment）和卦象（image）',
      '再读每个变爻的爻辞（lines[position].classical + modern_interpretation）',
      '最后读变卦的卦辞，理解变化的方向',
      '将以上内容综合映射到玩家的具体处境',
    ],
  },
  projection_guide: {
    instruction: [
      '玩家选了两张图片后，查看这两张图片的 dimensions 权重，',
      '取权重最高的 1-2 个维度作为「关注领域」信号。',
      '结合卦象的含义方向，生成一个具体推测。',
      '推测格式：点出领域 + 状态，不点出具体行动。',
      '好的推测：「你最近在思考一个关于职业方向的选择」',
      '过度具体：「你想辞职」',
      '过于模糊：「你最近有些心事」',
    ].join('\n'),
    dimension_labels: {
      relationship: '人际关系 / 情感',
      career: '职业 / 事业方向',
      identity: '自我认知 / 身份',
      health: '身心状态 / 健康',
      finance: '财务 / 资源',
      growth: '成长 / 学习 / 转变',
    },
  },
}
