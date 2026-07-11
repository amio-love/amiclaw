/**
 * The three shipped levels (L2 arch note B4). Rising tension comes from
 * pool scarcity + matrix traps + a rising score bar — NOT from a fail state
 * (free-flow, no-fail bloom).
 *
 * Each level defines its OWN harmony matrix. Level 1's matrix is the fixture
 * base (mostly friendly, one lone incompatible). Level 3's matrix is trapped
 * (several incompatible penalties) with `harp` as a safe "wildcard" that never
 * traps. Winnability under scarcity is not machine-guaranteed by the engine
 * (solver is scarcity-blind, F5), so reachability.test.ts brute-forces every
 * legal joint placement and asserts each target is reachable.
 */

import type { HarmonyMatrix, LevelConfig } from './types'

// Level 1 · 学步 — teach the plant→hear→partner-reacts loop. Ample pieces,
// mostly synergy/compatible, one lone trap (snare×flute) so "harsh" exists.
const LV1_MATRIX: HarmonyMatrix = {
  kick: { bell: 'synergy', chime: 'neutral', flute: 'compatible', harp: 'compatible' },
  snare: { bell: 'neutral', chime: 'synergy', flute: 'incompatible', harp: 'neutral' },
  hihat: { bell: 'compatible', chime: 'compatible', flute: 'synergy', harp: 'neutral' },
  clap: { bell: 'neutral', chime: 'neutral', flute: 'neutral', harp: 'synergy' },
}

// Level 2 · 取舍 — scarcity forces choosing WHICH slots to co-locate the few
// pieces on. Clear synergy diagonal, mostly neutral filler, no traps.
const LV2_MATRIX: HarmonyMatrix = {
  kick: { bell: 'synergy', chime: 'neutral', flute: 'neutral', harp: 'compatible' },
  snare: { bell: 'neutral', chime: 'synergy', flute: 'neutral', harp: 'neutral' },
  hihat: { bell: 'compatible', chime: 'neutral', flute: 'synergy', harp: 'neutral' },
  clap: { bell: 'neutral', chime: 'neutral', flute: 'neutral', harp: 'synergy' },
}

// Level 3 · 荆棘 — trapped matrix. Wrong pairings actively subtract; the safe
// path is found via the partner (who alone holds the matrix). `harp` is the
// wildcard: never a trap, compatible everywhere, synergy on clap.
const LV3_MATRIX: HarmonyMatrix = {
  kick: { bell: 'synergy', chime: 'incompatible', flute: 'neutral', harp: 'compatible' },
  snare: { bell: 'incompatible', chime: 'synergy', flute: 'neutral', harp: 'compatible' },
  hihat: { bell: 'neutral', chime: 'incompatible', flute: 'synergy', harp: 'compatible' },
  clap: { bell: 'incompatible', chime: 'neutral', flute: 'incompatible', harp: 'synergy' },
}

export const LEVELS: LevelConfig[] = [
  {
    id: 'sg-lv1-xuebu',
    index: 1,
    name: '学步',
    subtitle: '第一座花园',
    slots: 8,
    target: 8,
    matrix: LV1_MATRIX,
    // Ample: 2 of each type, 8 slots. Max achievable is far above target.
    melodyPool: { bell: 2, chime: 2, flute: 2, harp: 2 },
    rhythmPool: { kick: 2, snare: 2, hihat: 2, clap: 2 },
    tension: '材料充足，先学会种植与倾听',
  },
  {
    id: 'sg-lv2-qushe',
    index: 2,
    name: '取舍',
    subtitle: '每一株都要用在刀刃上',
    slots: 8,
    target: 10,
    matrix: LV2_MATRIX,
    // Scarce: 1 of each type. Max = perfect synergy diagonal (12). Target 10
    // demands strong pairing — must co-locate pieces on their synergy slots.
    melodyPool: { bell: 1, chime: 1, flute: 1, harp: 1 },
    rhythmPool: { kick: 1, snare: 1, hihat: 1, clap: 1 },
    tension: '材料稀缺——放错拍子就浪费了',
  },
  {
    id: 'sg-lv3-jingji',
    index: 3,
    name: '荆棘',
    subtitle: '刺耳的陷阱藏在其中',
    slots: 8,
    target: 13,
    matrix: LV3_MATRIX,
    // Scarce + a doubled wildcard (harp ×2 / clap ×2). Max = 15 (diagonal +
    // double clap×harp). Target 13 leaves almost no room for a trap.
    melodyPool: { bell: 1, chime: 1, flute: 1, harp: 2 },
    rhythmPool: { kick: 1, snare: 1, hihat: 1, clap: 2 },
    tension: '错误配对会倒扣——靠伙伴避开荆棘',
  },
]

export function levelByIndex(index: number): LevelConfig | undefined {
  return LEVELS.find((lv) => lv.index === index)
}
