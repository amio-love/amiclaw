/* Mock data for the「即将上线」(Upcoming Games) homepage section —
   handoff §6.6. Three games beyond BombSquad; every art panel is a CSS
   radial-gradient placeholder keyed by `artVariant`. Consumed by
   components/home/UpcomingGames. */

export type GameStatus = 'soon' | 'dev' | 'live'
export type GameArtVariant = 'echo' | 'draw' | 'lab'

export interface UpcomingGame {
  id: string
  name: string
  blurb: string
  status: GameStatus
  artVariant: GameArtVariant
}

export const upcomingGames: UpcomingGame[] = [
  {
    id: 'echo',
    name: '星海回声',
    blurb: '多人合奏 · 节拍呼应。和朋友＋AI 一起组一支临时乐队，60 秒一首。',
    status: 'soon',
    artVariant: 'echo',
  },
  {
    id: 'draw',
    name: '共绘星图',
    blurb: '协作绘画 · 你描述、AI 落笔。和陌生人接力，把一个想法画成壁纸。',
    status: 'soon',
    artVariant: 'draw',
  },
  {
    id: 'lab',
    name: 'Game Lab',
    blurb: '社区提案，我们来做。在 Discord 里写下你想和 AI 一起玩的小游戏。',
    status: 'dev',
    artVariant: 'lab',
  },
]
