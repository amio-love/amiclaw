/* Mock data for the「即将上线」(Upcoming Games) homepage section —
   handoff §6.6. Three games beyond BombSquad; every art panel is a CSS
   radial-gradient placeholder keyed by `artVariant`. Consumed by
   components/home/UpcomingGames. */

export type GameStatus = 'soon' | 'dev' | 'live' | 'preview'
export type GameArtVariant = 'echo' | 'draw' | 'lab' | 'oracle'

export interface UpcomingGame {
  id: string
  name: string
  blurb: string
  status: GameStatus
  artVariant: GameArtVariant
  /* When set, the tile becomes a clickable link to this URL. Used by
     'preview' tiles to route into a sibling-deployed prototype (e.g.
     /oracle/ for the Yijing Oracle build merged into game/dist/oracle/).
     'soon' / 'dev' tiles leave this undefined and stay non-clickable. */
  href?: string
  /* Real gameplay screenshot filling the art panel (playable games only —
     honest UI, no mockups). Unset tiles keep their gradient placeholder. */
  preview?: { src: string; width: number; height: number; alt: string }
}

// Oracle (易经签卜) is NOT listed here: it is live and daily-checkable (its own
// 今日清单 item + streak counting), so listing it under「即将上线 · IN ORBIT」
// with a「预览体验」badge contradicted its real status (F9). Discovery stays via
// the daily checklist; this section is only the genuinely-upcoming games.
export const upcomingGames: UpcomingGame[] = [
  {
    id: 'echo',
    name: '星海回声',
    blurb: '多人合奏，和朋友加 AI 组一支临时乐队。',
    status: 'soon',
    artVariant: 'echo',
  },
  {
    id: 'draw',
    name: '共绘星图',
    blurb: '你描述、AI 落笔，把一个想法画成壁纸。',
    status: 'soon',
    artVariant: 'draw',
  },
  {
    id: 'lab',
    name: 'Game Lab',
    blurb: '在 Discord 写下你想和 AI 一起玩的小游戏。',
    status: 'dev',
    artVariant: 'lab',
  },
]
