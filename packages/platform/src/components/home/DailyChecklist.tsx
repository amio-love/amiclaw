import { Disclosure } from '@amiclaw/ui'
import type { ArcadeProfileSummary } from '@amiclaw/arcade-profile/types'
import { formatLocalClockTime, getDailyResetHint, toChineseDateString } from '@shared/date'
import { useCompanion } from '@/hooks/useCompanion'
import styles from './DailyChecklist.module.css'

interface DailyChecklistProps {
  profile: ArcadeProfileSummary
  scope: 'account' | 'device'
}

export default function DailyChecklist({ profile, scope }: DailyChecklistProps) {
  const loop = profile.daily_loop
  // Cheap read of the shared, deduped companion store (enabled=false — never
  // triggers its own fetch; reflects whatever the signed-in home's WelcomeStrip
  // already loaded). Anonymous visitors have no companion, so the streak line
  // stays in its neutral phrasing. The companion's own NAME in the warm streak
  // narrative is allowed on this platform surface — ruling A restricts the
  // companion-given intimate name FOR THE PLAYER (address_style), not the
  // companion's name.
  const { state: companion } = useCompanion(false)
  const companionName = companion.status === 'exists' ? companion.companion.name.trim() : ''

  const days = loop.streak.current_days
  // Default state is ONE emotional fact (rc §3): companion-flavored when a
  // companion exists, neutral otherwise.
  const streakFact =
    days <= 0
      ? '新的一天，来玩第一局。'
      : companionName.length > 0
        ? `和${companionName}一起来到第 ${days} 天`
        : `连续第 ${days} 天，今天也来了`
  // The operational caveats relocate behind the ⓘ — honesty content is not
  // deleted, only moved off the default emotional position: longest streak +
  // the UTC reset boundary + (device scope only) the anonymous-device note.
  const streakDetail = `最长 ${loop.streak.longest_days} 天 · ${getDailyResetHint()}${
    scope === 'device' ? ' · 匿名状态只代表这台设备' : ''
  }`

  const items = [
    {
      id: 'bombsquad',
      title: 'BombSquad 每日挑战',
      detail: '成功拆除才计入连续打卡',
      href: '/bombsquad/',
      completed: loop.checklist.bombsquad_daily.completed,
      completedAt: loop.checklist.bombsquad_daily.completed_at,
    },
    {
      id: 'oracle',
      title: 'Oracle 今日卦签',
      detail: '走完起卦流程才计入连续打卡',
      href: '/oracle/#/home',
      completed: loop.checklist.oracle_sign.completed,
      completedAt: loop.checklist.oracle_sign.completed_at,
    },
  ]

  return (
    <section className={styles.section} aria-label="今日清单">
      <div className={styles.header}>
        <div>
          <p className={styles.kicker}>{toChineseDateString(loop.date)} · 今日清单</p>
          <h2 className={styles.title}>
            {loop.streak.today_completed ? '今日已打卡' : '今天还没打卡'}
          </h2>
        </div>
        <div className={styles.streak}>
          <span className={styles.streakValue}>{days}</span>
          <span className={styles.streakLabel}>连续天数</span>
        </div>
      </div>

      <div className={styles.items}>
        {items.map((item) => (
          <a key={item.id} className={styles.item} href={item.href}>
            <span
              className={item.completed ? styles.checkDone : styles.checkTodo}
              aria-hidden="true"
            >
              {item.completed ? '✓' : '○'}
            </span>
            <span className={styles.itemBody}>
              <span className={styles.itemTitle}>{item.title}</span>
              <span className={styles.itemDetail}>
                {/* The completed line shows WHEN the item was done today — the
                    local wall-clock time of completion (完成于 HH:MM), not the
                    game 用时. The result page and /me show the run DURATION
                    (formatMs, e.g. 00:17); the bare「· 04:44」here used to read
                    as a duration too and looked contradictory (F3). 「完成于」
                    labels it as a point in time and reads the same for both the
                    timed BombSquad run and the untimed Oracle sign. */}
                {item.completed
                  ? item.completedAt
                    ? `完成于 ${formatLocalClockTime(item.completedAt)}`
                    : '已完成'
                  : item.detail}
              </span>
            </span>
            <span className={styles.itemAction}>{item.completed ? '再玩' : '开始'}</span>
          </a>
        ))}
      </div>

      <p className={styles.streakFact}>
        {streakFact}
        <Disclosure label="连续打卡说明">{streakDetail}</Disclosure>
      </p>
    </section>
  )
}
