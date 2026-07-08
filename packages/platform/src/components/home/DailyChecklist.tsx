import type { ArcadeProfileSummary } from '@amiclaw/arcade-profile/types'
import { formatLocalClockTime, getDailyResetHint, toChineseDateString } from '@shared/date'
import styles from './DailyChecklist.module.css'

interface DailyChecklistProps {
  profile: ArcadeProfileSummary
  scope: 'account' | 'device'
  loading?: boolean
}

export default function DailyChecklist({ profile, scope, loading = false }: DailyChecklistProps) {
  const loop = profile.daily_loop
  const scopeText = scope === 'account' ? '本账号' : '本设备'
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
          <span className={styles.streakValue}>{loop.streak.current_days}</span>
          <span className={styles.streakLabel}>连续天数 · {scopeText}</span>
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
                {item.completed
                  ? `已完成${item.completedAt ? ` · ${formatLocalClockTime(item.completedAt)}` : ''}`
                  : item.detail}
              </span>
            </span>
            <span className={styles.itemAction}>{item.completed ? '再玩' : '开始'}</span>
          </a>
        ))}
      </div>

      <p className={styles.note}>
        {loading
          ? '正在读取账号记录；暂时显示这台设备上的状态。'
          : `最长连续 ${loop.streak.longest_days} 天。匿名状态只代表这台设备。`}
      </p>
      <p className={styles.hint}>{getDailyResetHint()}</p>
    </section>
  )
}
