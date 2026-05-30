/* Mock data for the account page — handoff §6.11 (the Phase 8 account
   page). `recentRuns` feeds the「最近 5 局」table; `badges` feeds the
   勋章 grid. Profile-card identity (name / ranks / streak / fastest)
   reuses `mockUser` from ./auth — see pages/AccountPage. */

/* A single row in the「最近 5 局」table. `icon` is the short game
   badge text; `mode` is the play mode (每日 / 练习); `rank` is the
   finishing rank, or「—」for practice runs that are not ranked. */
export interface RecentRun {
  id: string
  icon: string
  game: string
  mode: string
  time: string
  rank: string
}

export const recentRuns: RecentRun[] = [
  { id: 'run-1', icon: 'BS', game: 'BombSquad', mode: '每日', time: '02:14', rank: '#247' },
  { id: 'run-2', icon: 'BS', game: 'BombSquad', mode: '练习', time: '04:38', rank: '—' },
  { id: 'run-3', icon: 'BS', game: 'BombSquad', mode: '每日', time: '03:01', rank: '#312' },
  { id: 'run-4', icon: 'BS', game: 'BombSquad', mode: '练习', time: '05:22', rank: '—' },
  { id: 'run-5', icon: 'BS', game: 'BombSquad', mode: '每日', time: '02:54', rank: '#284' },
]

/* An earned achievement badge — rendered as a conic ring with a yellow
   star and the name below. The star is constant across badges, so it is
   drawn by the component, not stored here. */
export interface Badge {
  id: string
  name: string
}

export const badges: Badge[] = [
  { id: 'badge-1', name: '首拆' },
  { id: 'badge-2', name: '连胜5' },
  { id: 'badge-3', name: '单日5局' },
  { id: 'badge-4', name: '日榜Top100' },
]
