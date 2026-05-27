// Demo manual — single hexagram (乾) ported verbatim from
// pages/projects/amiclaw/yijing-oracle-design.md §数据结构设计.
// Purpose: validate `schema.ts` shape and provide a fixture for sibling 2.
// Full 64-hex data + projection_images come later (sibling 2 / Phase 2).

import type { HexagramEntry, Manual } from './schema'

export const demoHexagram: HexagramEntry = {
  number: 1,
  name: { chinese: '乾', pinyin: 'qián', english: 'The Creative / Heaven' },
  trigrams: { upper: '乾 (天)', lower: '乾 (天)' },
  judgment: {
    classical: '乾：元，亨，利，贞。',
    modern_interpretation: '乾卦代表纯阳之力，创造与开始的能量。元始、亨通、和谐、正固——四德俱全。',
    keywords: ['创造', '力量', '开始', '坚持'],
  },
  image: {
    classical: '天行健，君子以自强不息。',
    modern_interpretation: '天体运行刚健不止，人应效法天道，持续自我激励、永不懈怠。',
  },
  lines: [
    {
      position: 1,
      name: '初九',
      classical: '潜龙勿用。',
      modern_interpretation: '力量处于潜伏期，时机未到不宜行动。积蓄能量，等待机会。',
      changing_guidance: '此爻变动时，提示当前不是行动的时机，宜蛰伏积累。',
    },
    {
      position: 2,
      name: '九二',
      classical: '见龙在田，利见大人。',
      modern_interpretation: '才能开始显现，适合寻找导师或合作者。',
      changing_guidance: '此爻变动时，暗示与重要人物的相遇或合作契机将至。',
    },
    {
      position: 3,
      name: '九三',
      classical: '君子终日乾乾，夕惕若厉，无咎。',
      modern_interpretation: '白天勤勉不辍，夜晚警惕反省，虽有危险但不会犯错。',
      changing_guidance: '此爻变动时，强调谨慎与勤勉的重要性——努力本身就是方向。',
    },
    {
      position: 4,
      name: '九四',
      classical: '或跃在渊，无咎。',
      modern_interpretation: '在跳跃与深潜之间选择，两者皆无过错。关键是审时度势。',
      changing_guidance: '此爻变动时，面临重大抉择，但无论哪个方向都不会是错的。',
    },
    {
      position: 5,
      name: '九五',
      classical: '飞龙在天，利见大人。',
      modern_interpretation: '达到最佳状态，适合与志同道合者合作共事。',
      changing_guidance: '此爻变动时，正处于最有影响力的时刻，把握机会。',
    },
    {
      position: 6,
      name: '上九',
      classical: '亢龙有悔。',
      modern_interpretation: '到达极高之处反有遗憾。过刚则折，物极必反。',
      changing_guidance: '此爻变动时，警示当前可能已经走得太远，需要适度收敛。',
    },
  ],
  relationships: { opposite: 2, nuclear_upper: 1, nuclear_lower: 1 },
}

export const demoManual: Manual = {
  metadata: {
    type: 'yijing-oracle',
    version: '0.1.0',
    // Demo manual contains only 乾; full base manual will set 64 / 384.
    total_hexagrams: 1,
    total_lines: 6,
  },
  // Sibling 2 fills with the demo 6 images per handoff §6.2.
  projection_images: [],
  hexagrams: [demoHexagram],
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
