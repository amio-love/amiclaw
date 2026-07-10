import { useCallback, useEffect, useState } from 'react'
import { Button, toolLabel } from '@amiclaw/ui'
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

function formatAiMetadata(entry: LeaderboardEntry): string | null {
  if (!entry.ai_tool) return null
  // Resolve the stored lowercase tool id through the shared AI_TOOLS source so
  // all 8 tools render their display name (was a local 3-item map that leaked
  // raw ids for the other tools).
  const tool = toolLabel(entry.ai_tool)
  return entry.ai_model ? `${tool} · ${entry.ai_model}` : tool
}

/* The Atlas grid-row list — a CSS-grid table (not a <table>) carrying ARIA
   roles so the structure stays test-queryable: container role="table", a
   header role="row" with role="columnheader" cells, each entry role="row"
   with role="cell" cells. Rendered by the real daily board below; exported so
   other real-data surfaces can reuse the same grid markup. */
export function LeaderboardRows({ entries }: { entries: LeaderboardEntry[] }) {
  // The anonymous board dedups per device, not per nickname, so two different
  // devices that picked the same name each keep a row (see leaderboard-entries).
  // Without a marker, two identical「审计员W4」rows read to a cold visitor like a
  // bug or a refresh dupe. Number each colliding name so the rows read as two
  // distinct players who happen to share a name (F2). Distinct devices' records
  // are never silently merged — the honest render is disambiguation, not
  // collapse (the client cannot even see device_id; it is stripped server-side).
  const nameCounts = new Map<string, number>()
  for (const row of entries) nameCounts.set(row.nickname, (nameCounts.get(row.nickname) ?? 0) + 1)
  const seen = new Map<string, number>()
  const dupOrdinals = entries.map((row) => {
    if ((nameCounts.get(row.nickname) ?? 0) <= 1) return 0
    const n = (seen.get(row.nickname) ?? 0) + 1
    seen.set(row.nickname, n)
    return n
  })

  return (
    <div className={styles.list} role="table" aria-label="排行榜">
      <div className={styles.headRow} role="row">
        <span role="columnheader">名次</span>
        <span role="columnheader">玩家</span>
        {/* attempt_number is which daily attempt set this time — it is NOT a
            mistake count, so the header must not say 失误. */}
        <span className={styles.headScore} role="columnheader">
          用时 · 尝试
        </span>
      </div>
      {entries.map((row, i) => {
        const isYou = row.nickname.includes('你')
        const dupOrdinal = dupOrdinals[i]
        const aiMetadata = formatAiMetadata(row)
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
            <span className={styles.nameCell} role="cell">
              <span className={styles.name}>
                {row.nickname}
                {dupOrdinal > 0 && (
                  <span className={styles.dupTag} title="与其他玩家同名">
                    {' '}
                    · 同名 {dupOrdinal}
                  </span>
                )}
              </span>
              {aiMetadata && <span className={styles.aiMeta}>{aiMetadata}</span>}
            </span>
            <span className={styles.score} role="cell">
              {formatMs(row.time_ms)} · 第 {row.attempt_number} 次
            </span>
          </div>
        )
      })}
    </div>
  )
}

/* 每日 tab — the real leaderboard API. Lifts the fetch + optimistic
   merge/clear flow verbatim from the pre-Atlas LeaderboardPage so the
   daily behavior carries zero regression.

   `date` selects which product day's board to show (defaults to today).
   Optimistic entries are persisted per-date by the result page, so past
   boards simply never find one. Callers that switch dates re-mount this
   component (`key={date}`) so each board starts from a clean loading state. */
export default function DailyLeaderboardList({ date }: { date?: string } = {}) {
  const boardDate = date ?? getTodayString()
  const isToday = boardDate === getTodayString()
  // Seed from any optimistic entry persisted by the result page so the player
  // sees their freshly-submitted row before the GET resolves.
  const [entries, setEntries] = useState<LeaderboardEntry[]>(() => {
    const optimistic = loadOptimisticEntry(boardDate)
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
    fetchLeaderboard(boardDate).then((data) => {
      setLoading(false)
      if (data) {
        // Server response is authoritative. If an optimistic entry is still
        // around AND the GET payload doesn't yet include it (cache hasn't
        // flipped), splice it in at its claimed rank so the player still sees
        // it. Once the cache flips and the GET contains the real row, drop the
        // optimistic copy and let the server response stand on its own.
        const optimistic = loadOptimisticEntry(boardDate)
        if (optimistic && !entriesContainOptimistic(data.entries, optimistic)) {
          setEntries(mergeOptimisticEntry(data.entries, optimistic))
        } else {
          if (optimistic) clearOptimisticEntry(boardDate)
          setEntries(data.entries)
        }
      } else {
        setError(true)
      }
    })
  }, [boardDate])

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
      {/* Callers never navigate past LEADERBOARD_RETENTION_DAYS, so an empty
          board here genuinely means nobody made the board that day — never
          that the day's data expired. */}
      {!loading && !error && entries.length === 0 && (
        <p className={styles.status}>
          {isToday ? '今日还没有成绩，来抢第一！' : '这一天没有人上榜。'}
        </p>
      )}
      {entries.length > 0 && <LeaderboardRows entries={entries} />}
    </>
  )
}
