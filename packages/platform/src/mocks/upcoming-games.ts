/* Mock data for the「即将上线」(Upcoming Games) homepage section —
   handoff §6.6. Three games beyond BombSquad; every art panel is a CSS
   radial-gradient placeholder keyed by `artVariant`. Consumed by
   components/home/UpcomingGames. */

export type GameStatus = 'soon' | 'dev' | 'live'
export type GameArtVariant = 'shadow' | 'oracle' | 'garden' | 'echo' | 'draw' | 'lab'

export interface UpcomingGame {
  id: string
  name: string
  blurb: string
  status: GameStatus
  artVariant: GameArtVariant
  /* Playable peer games carry a same-origin entry link. Future games leave
     this undefined and stay non-clickable. */
  href?: string
  /* Real gameplay screenshot filling the art panel (playable games only —
     honest UI, no mockups). Unset tiles keep their gradient placeholder. */
  preview?: { src: string; width: number; height: number; alt: string }
}

export const upcomingGames: UpcomingGame[] = [
  {
    id: 'shadow-chase',
    name: '双影追逃',
    blurb: '你操控一道影子，和 AI 伙伴分头、诱敌、救援，再一起离开。',
    status: 'live',
    artVariant: 'shadow',
    href: '/shadow-chase/',
  },
  {
    id: 'oracle',
    name: '易经签卜',
    blurb: '选两张心象，掷六次铜钱，和 AI 一起读出今日卦签。',
    status: 'live',
    artVariant: 'oracle',
    href: '/oracle/#/home',
    preview: {
      src: '/previews/oracle-cast.webp',
      width: 640,
      height: 853,
      alt: '易经签卜的投币起卦界面',
    },
  },
  {
    id: 'botanical',
    name: '植物园养护',
    blurb: '花园在慢慢枯萎，你和 AI 伙伴一株株把它救回来。',
    status: 'live',
    artVariant: 'garden',
    href: '/botanical/',
  },
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

/** BombSquad is the one featured live game; the two live peers sit above. */
export const PLAYABLE_GAME_COUNT = 1 + upcomingGames.filter((game) => game.status === 'live').length
