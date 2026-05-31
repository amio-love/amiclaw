import { useCallback, useEffect, useState } from 'react'
import { Button } from '@amiclaw/ui'
import { fetchLeaderboard } from '@shared/leaderboard-api'
import {
  clearOptimisticEntry,
  entriesContainOptimistic,
  loadOptimisticEntry,
  mergeOptimisticEntry,
  type OptimisticLeaderboardEntry,
} from '@shared/leaderboard-optimistic'
import { getTodayString } from '@shared/date'
import { formatMs } from '@shared/format-time'
import type { LeaderboardEntry } from '@shared/leaderboard-types'
import styles from './DailyLeaderboardList.module.css'

function isOptimistic(entry: LeaderboardEntry): entry is OptimisticLeaderboardEntry {
  return (entry as OptimisticLeaderboardEntry)._justSubmitted === true
}

/* The Atlas grid-row list — a CSS-grid table (not a <table>) carrying ARIA
   roles so the structure stays test-queryable: container role="table", a
   header role="row" with role="columnheader" cells, each entry role="row"
   with role="cell" cells. Shared by the real daily board below and the mock
   week / month / 历史 boards (MockLeaderboardList). */
export function LeaderboardRows({ entries }: { entries: LeaderboardEntry[] }) {
  return (
    <div className={styles.list} role="table" aria-label="排行榜">
      <div className={styles.headRow} role="row">
        <span role="columnheader">名次</span>
        <span role="columnheader">玩家</span>
        <span className={styles.headScore} role="columnheader">
          用时 · 失误
        </span>
      </div>
      {entries.map((row) => {
        const isYou = row.nickname.includes('你')
        const rowClass = [
          styles.row,
          row.rank <= 3 ? styles.rowTop : '',
          isYou ? styles.rowYou : '',
        ]
          .filter(Boolean)
          .join(' ')
        return (
          <div
            key={row.rank}
            className={rowClass}
            role="row"
            data-just-submitted={isOptimistic(row) ? 'true' : undefined}
          >
            <span className={styles.rank} role="cell">
              #{String(row.rank).padStart(3, '0')}
            </span>
            <span className={styles.name} role="cell">
              {row.nickname}
            </span>
            <span className={styles.score} role="cell">
              {formatMs(row.time_ms)} · {row.attempt_number} 次
            </span>
          </div>
        )
      })}
    </div>
  )
}

/* 每日 tab — the real leaderboard API. Lifts the fetch + optimistic
   merge/clear flow verbatim from the pre-Atlas LeaderboardPage so the
   daily behavior carries zero regression. */
export default function DailyLeaderboardList() {
  const today = getTodayString()
  // Seed from any optimistic entry persisted by the result page so the player
  // sees their freshly-submitted row before the GET resolves.
  const [entries, setEntries] = useState<LeaderboardEntry[]>(() => {
    const optimistic = loadOptimisticEntry(today)
    return optimistic ? [optimistic] : []
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  // The fetch + merge body is shared between mount and retry. Synchronous
  // `setLoading(true)` / `setError(false)` are deliberately kept OUT of here so
  // calling it from `useEffect` doesn't trigger react-hooks/set-state-in-effect;
  // the mount path relies on the initial `loading: true` / `error: false` state,
  // and the retry handler resets both before calling this.
  const fetchEntries = useCallback(() => {
    fetchLeaderboard(today).then((data) => {
      setLoading(false)
      if (data) {
        // Server response is authoritative. If an optimistic entry is still
        // around AND the GET payload doesn't yet include it (cache hasn't
        // flipped), splice it in at its claimed rank so the player still sees
        // it. Once the cache flips and the GET contains the real row, drop the
        // optimistic copy and let the server response stand on its own.
        const optimistic = loadOptimisticEntry(today)
        if (optimistic && !entriesContainOptimistic(data.entries, optimistic)) {
          setEntries(mergeOptimisticEntry(data.entries, optimistic))
        } else {
          if (optimistic) clearOptimisticEntry(today)
          setEntries(data.entries)
        }
      } else {
        setError(true)
      }
    })
  }, [today])

  useEffect(() => {
    fetchEntries()
  }, [fetchEntries])

  const handleRetry = useCallback(() => {
    setLoading(true)
    setError(false)
    fetchEntries()
  }, [fetchEntries])

  return (
    <>
      {loading && <p className={styles.status}>加载中…</p>}
      {error && (
        <div className={styles.errorBlock}>
          <p className={styles.status}>排行榜暂不可用，稍后再试。</p>
          <Button variant="ghost" size="sm" onClick={handleRetry}>
            重试
          </Button>
          <p className={styles.statusMuted}>若一直无法访问，可邮件 byheaven0912@gmail.com 反馈</p>
        </div>
      )}
      {!loading && !error && entries.length === 0 && (
        <p className={styles.status}>今日还没有成绩，来抢第一！</p>
      )}
      {entries.length > 0 && <LeaderboardRows entries={entries} />}
    </>
  )
}
