/**
 * Curated Chinese tongue-twister pool for the BombSquad scene-info HUD.
 *
 * Each entry is a short Chinese phrase (≤ 16 characters) that the player
 * reads aloud to the AI partner — pronouncing it correctly is part of the
 * cooperative challenge. The 16-character cap keeps the phrase on one line
 * inside `SceneInfoBar` on a 370 px viewport.
 *
 * Starter set; the user is expected to review and edit this list. Categories
 * roughly aim for variety: numbers / measure words, tone confusion (same
 * initials with shifted tones), articulation difficulty (bilabial / fricative
 * clusters), and fun cultural classics. Phrases are drawn from common public
 * Chinese tongue-twister collections — no proprietary or copyrighted content.
 */
export const TONGUE_TWISTERS = [
  // numbers — sì / shí confusion is the canonical Chinese tongue-twister axis
  '四是四十是十',
  '十四是十四',
  '四十是四十',
  '不要把十四说四十',
  '也不要把四十说十四',

  // tone confusion — same syllable, different tones
  '妈骂麻马吃马草',
  '红凤凰黄凤凰',
  '老六放牛卢牛',
  '蓝南天的蓝布裤',
  '吃柿子不吐柿子皮',

  // bilabial / aspiration — articulation drills
  '八百标兵奔北坡',
  '炮兵并排北边跑',
  '吃葡萄不吐葡萄皮',
  '不吃葡萄倒吐葡萄皮',
  '哥挎瓜筐过宽沟',

  // cultural classics — short, well-known
  '门口有四十四只狮子',
  '板凳宽扁担长',
  '扁担没有板凳宽',
  '黑化肥发灰会挥发',
  '灰化肥挥发会发黑',
] as const

export type TongueTwister = (typeof TONGUE_TWISTERS)[number]
