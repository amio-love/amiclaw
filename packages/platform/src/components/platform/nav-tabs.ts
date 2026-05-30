/* The 4 platform navigation tabs, shared by TopNav (desktop) and BottomNav
   (mobile) so the labels and routes stay in sync. */

export interface NavTab {
  to: string
  label: string
}

export const NAV_TABS: NavTab[] = [
  { to: '/', label: '游戏' },
  { to: '/leaderboard', label: '排行榜' },
  { to: '/community', label: '社区' },
  { to: '/me', label: '我的' },
]
