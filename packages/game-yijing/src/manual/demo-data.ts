// Demo manual — small fixture set covering the DEMO flow (handoff §6.3 §6.4).
//
// Hexagrams included:
//   · 乾 #1  — ported verbatim from yijing-oracle-design.md §数据结构设计
//             (used by sibling 1 to validate `schema.ts` shape).
//   · 同人 #13 — demo cast result: bottom-up `[7,8,9,7,7,7]` → binary 101111.
//   · 无妄 #25 — variant of 同人 after the 9→8 change at 九三: `[7,8,8,7,7,7]`
//             → binary 100111. Per handoff prototype/yijing/screens.jsx §02.
//
// Line-text fields for #13 and #25 carry CLASSICAL judgment lines verbatim
// (well-attested 通行本 wording). The `modern_interpretation` + `changing_guidance`
// fields use Phase-1 stub prose so PageReading + PageSign can render real text;
// production data will replace these with curated content.
//
// `projection_images` is filled with 6 placeholder entries that route to the
// in-codebase `ProjArt` SVG glyphs (`a..f`) via the new `placeholder_ref`
// field (schema.ts). Per-image `dimensions` weights mirror the per-id table
// already declared in `glyphs/ProjArt.tsx#PROJ_DIMENSIONS`.

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

/* #13 同人 — bottom-up `[7,8,9,7,7,7]` → binary 101111. Demo cast result. */
export const demoHexagramTongren: HexagramEntry = {
  number: 13,
  name: { chinese: '同人', pinyin: 'tóng rén', english: 'Fellowship with Men' },
  trigrams: { upper: '乾 (天)', lower: '离 (火)' },
  judgment: {
    classical: '同人于野，亨。利涉大川，利君子贞。',
    modern_interpretation:
      '在更广阔的场域中与人同心，亨通。适合涉越大河，适合君子坚守正道。同行不靠强迫，靠方向一致。',
    keywords: ['同行', '协作', '方向', '坚守'],
  },
  image: {
    classical: '天与火，同人；君子以类族辨物。',
    modern_interpretation: '天在上、火在下，火向上烧，方向与天相合；君子据此分辨同类、识别异同。',
  },
  lines: [
    {
      position: 1,
      name: '初九',
      classical: '同人于门，无咎。',
      modern_interpretation: '在门口与人同行——刚起步，门户敞开，没有错。',
      changing_guidance: '此爻变动时，提示从开放的起点出发，先建立公开的连接。',
    },
    {
      position: 2,
      name: '六二',
      classical: '同人于宗，吝。',
      modern_interpretation: '只与自己宗族内同行——视野受限，难免遗憾。',
      changing_guidance: '此爻变动时，提示警惕同温层，拓展圈层之外的对话。',
    },
    {
      position: 3,
      name: '九三',
      classical: '伏戎于莽，升其高陵，三岁不兴。',
      modern_interpretation:
        '把兵藏进草丛，登上高陵远望，三年都不轻举妄动。主动停一停，不是放弃，是让真正的同行人显形。',
      changing_guidance:
        '此爻变动时——核心提示：与其急于推进，不如先停下来观察方向与同行人是否真正一致。',
    },
    {
      position: 4,
      name: '九四',
      classical: '乘其墉，弗克攻，吉。',
      modern_interpretation: '登上城墙却没有发动进攻——克制即吉。势已成，可以不打。',
      changing_guidance: '此爻变动时，强调克制是更高阶的力量。',
    },
    {
      position: 5,
      name: '九五',
      classical: '同人，先号咷而后笑。大师克相遇。',
      modern_interpretation: '同行先经痛哭后能相视而笑——付出大代价后终能相遇。',
      changing_guidance: '此爻变动时，提示当下的拉扯是通向真正同行的必经路。',
    },
    {
      position: 6,
      name: '上九',
      classical: '同人于郊，无悔。',
      modern_interpretation: '在郊外与人同行——更广阔的场域中，无所遗憾。',
      changing_guidance: '此爻变动时，提示把场域再放大一些，无须计较得失。',
    },
  ],
  relationships: { opposite: 7, nuclear_upper: 44, nuclear_lower: 44 },
}

/* #25 无妄 — variant of 同人 after 9→8 at 九三; bottom-up `[7,8,8,7,7,7]`
   → binary 100111. The demo cast's 变卦. */
export const demoHexagramWuwang: HexagramEntry = {
  number: 25,
  name: { chinese: '无妄', pinyin: 'wú wàng', english: 'Innocence / The Unexpected' },
  trigrams: { upper: '乾 (天)', lower: '震 (雷)' },
  judgment: {
    classical: '无妄，元亨，利贞。其匪正有眚，不利有攸往。',
    modern_interpretation: '不妄动则大亨通，利于坚守正道。若动机不正便招灾，此时不宜远行或新拓。',
    keywords: ['真诚', '不妄动', '正道', '审慎'],
  },
  image: {
    classical: '天下雷行，物与无妄；先王以茂对时育万物。',
    modern_interpretation: '天下雷震，万物各自无妄，应时而生；先王据此顺时养育万物。',
  },
  lines: [
    {
      position: 1,
      name: '初九',
      classical: '无妄，往吉。',
      modern_interpretation: '不存妄念地前往——吉。',
      changing_guidance: '此爻变动时，提示心存正念地行动即可顺利。',
    },
    {
      position: 2,
      name: '六二',
      classical: '不耕获，不菑畬，则利有攸往。',
      modern_interpretation: '不刻意耕作收获，不刻意开荒——顺势而行反而有利。',
      changing_guidance: '此爻变动时，提示放下结果焦虑，专注当下。',
    },
    {
      position: 3,
      name: '六三',
      classical: '无妄之灾。或系之牛，行人之得，邑人之灾。',
      modern_interpretation: '无妄之灾——拴住的牛被路人牵走，邑人遭无端损失。',
      changing_guidance: '此爻变动时，提示无端之祸有时难免，需平心面对。',
    },
    {
      position: 4,
      name: '九四',
      classical: '可贞，无咎。',
      modern_interpretation: '可以坚守，没有过错。',
      changing_guidance: '此爻变动时，提示稳守现状即可。',
    },
    {
      position: 5,
      name: '九五',
      classical: '无妄之疾，勿药有喜。',
      modern_interpretation: '无端的小病，不用吃药也会好转。',
      changing_guidance: '此爻变动时，提示有些问题自然消解，不必过度干预。',
    },
    {
      position: 6,
      name: '上九',
      classical: '无妄，行有眚，无攸利。',
      modern_interpretation: '此时再动便招祸，无所利益。',
      changing_guidance: '此爻变动时，明确提示——此刻不动是最优解。',
    },
  ],
  relationships: { opposite: 46, nuclear_upper: 53, nuclear_lower: 53 },
}

export const demoManual: Manual = {
  metadata: {
    type: 'yijing-oracle',
    version: '0.2.0',
    // Demo manual now contains 乾 + 同人 + 无妄 — 3 hexagrams × 6 lines = 18.
    total_hexagrams: 3,
    total_lines: 18,
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
  hexagrams: [demoHexagram, demoHexagramTongren, demoHexagramWuwang],
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
