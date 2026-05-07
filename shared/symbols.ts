/**
 * SVG symbol pool for DialModule and KeypadModule.
 * Each symbol has a unique id, human-readable name, description for voice use,
 * and SVG path data rendered in a 100×100 viewBox.
 *
 * `description` is Chinese and tuned for AI-to-player visual disambiguation:
 * canonical shape FIRST, then the most likely user-confusion phrasing in
 * "易被误描述为'X'" form. The same descriptions ship inside each manual
 * YAML's `symbols:` block so the AI sees them when reading the manual; this
 * registry is the source of the strings injected into the assistant prompt.
 */

export interface Symbol {
  id: string
  name: string
  description: string // How a player would describe it verbally
  path: string // SVG path data (viewBox 0 0 100 100)
}

export const SYMBOLS: readonly Symbol[] = [
  {
    id: 'omega',
    name: 'Omega',
    description: '马蹄铁形 / 倒 U 形,底部两个向外的小脚,中间无竖线穿过',
    path: 'M50 15 C25 15 10 30 10 50 C10 70 25 82 38 85 L38 90 L30 90 L30 95 L70 95 L70 90 L62 90 L62 85 C75 82 90 70 90 50 C90 30 75 15 50 15 Z M50 25 C68 25 80 36 80 50 C80 64 68 76 54 78 L54 90 L46 90 L46 78 C32 76 20 64 20 50 C20 36 32 25 50 25 Z',
  },
  {
    id: 'psi',
    name: 'Psi',
    description: "类似 U 形碗中间一根长竖线穿过、并向下延伸超出碗底,容易被误描述为'三叉戟'",
    path: 'M50 5 L50 35 M30 15 L30 50 C30 65 38 72 50 72 C62 72 70 65 70 50 L70 15 M50 72 L50 95',
  },
  {
    id: 'delta',
    name: 'Delta',
    description: '等边三角形 △,三条直边围成封闭三角',
    path: 'M50 10 L90 85 L10 85 Z',
  },
  {
    id: 'star',
    name: 'Star',
    description: '标准五角星 ☆,五个等长尖角向外',
    path: 'M50 5 L61 35 L95 35 L68 57 L79 91 L50 70 L21 91 L32 57 L5 35 L39 35 Z',
  },
  {
    id: 'xi',
    name: 'Xi',
    description: '三条等长的平行横线,Ξ 形,无竖线无圆弧',
    path: 'M15 25 L85 25 M15 50 L85 50 M15 75 L85 75',
  },
  {
    id: 'diamond',
    name: 'Diamond',
    description: '正方形旋转 45 度后的菱形 ◇,四条等长边对角对称',
    path: 'M50 5 L95 50 L50 95 L5 50 Z',
  },
  {
    id: 'trident',
    name: 'Trident',
    description:
      "三根并排竖向尖刺,顶部两条弧分别连接左-中和中-右刺(像折扇展开,n|n 模式),容易被误描述为'扇子'",
    path: 'M50 10 L50 90 M30 10 C20 10 15 20 15 30 L15 50 M70 10 C80 10 85 20 85 30 L85 50 M30 10 L30 40 M70 10 L70 40',
  },
  {
    id: 'crescent',
    name: 'Crescent',
    description: '弯月形 / 月牙形,一弯朝同一方向开口的弧线,内外两条弧近乎平行',
    path: 'M65 15 C40 15 20 30 20 50 C20 70 40 85 65 85 C50 75 42 63 42 50 C42 37 50 25 65 15 Z',
  },
  {
    id: 'spiral',
    name: 'Spiral',
    description: 'spiral coiling inward',
    path: 'M50 50 C50 30 65 20 75 25 C90 32 90 55 75 65 C60 75 35 70 25 55 C12 37 20 15 38 10 C58 4 80 15 85 38',
  },
  {
    id: 'cross',
    name: 'Cross',
    description: 'plus sign or cross',
    path: 'M50 10 L50 90 M10 50 L90 50',
  },
  {
    id: 'eye',
    name: 'Eye',
    description: 'eye shape with a dot in the center',
    path: 'M10 50 C25 25 75 25 90 50 C75 75 25 75 10 50 Z M50 50 m-8 0 a8 8 0 1 0 16 0 a8 8 0 1 0 -16 0',
  },
  {
    id: 'lambda',
    name: 'Lambda',
    description: 'upside-down V shape',
    path: 'M10 90 L50 10 L90 90',
  },
  {
    id: 'hourglass',
    name: 'Hourglass',
    description: 'two triangles touching at their points',
    path: 'M10 10 L90 10 L50 50 L90 90 L10 90 L50 50 Z',
  },
  {
    id: 'arrow-loop',
    name: 'Arrow Loop',
    description: 'circular arrow pointing right',
    path: 'M30 50 C30 30 45 15 60 15 C75 15 85 28 85 40 C85 55 72 65 60 65 L60 55 L40 70 L60 85 L60 75 C80 75 95 62 95 45 C95 25 80 5 60 5 C38 5 20 22 20 45',
  },
  {
    id: 'target',
    name: 'Target',
    description: 'circle with a dot in the center',
    path: 'M50 50 m-35 0 a35 35 0 1 0 70 0 a35 35 0 1 0 -70 0 M50 50 m-8 0 a8 8 0 1 0 16 0 a8 8 0 1 0 -16 0',
  },
  {
    id: 'zigzag',
    name: 'Zigzag',
    description: 'zigzag or lightning bolt shape',
    path: 'M60 5 L25 50 L55 50 L40 95 L75 45 L45 45 Z',
  },
]

/** Look up a symbol by id. Throws if not found. */
export function getSymbol(id: string): Symbol {
  const sym = SYMBOLS.find((s) => s.id === id)
  if (!sym) throw new Error(`Unknown symbol id: ${id}`)
  return sym
}
