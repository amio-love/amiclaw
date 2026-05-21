import type { LeaderboardEntry } from '@shared/leaderboard-types'
import { LeaderboardRows } from './DailyLeaderboardList'

interface MockLeaderboardListProps {
  /* Week / month / all-time mock rows from mocks/leaderboard.ts. */
  entries: LeaderboardEntry[]
}

/* 本周 / 本月 / 历史 tabs — mock aggregate rows rendered through the
   exact same grid-row list as the real daily board. */
export default function MockLeaderboardList({ entries }: MockLeaderboardListProps) {
  return <LeaderboardRows entries={entries} />
}
