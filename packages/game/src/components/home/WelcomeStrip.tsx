import ConicAvatar from '@/components/ui/ConicAvatar'
import type { MockUser } from '@/mocks/auth'
import styles from './WelcomeStrip.module.css'

interface WelcomeStripProps {
  user: MockUser
}

/* Signed-in welcome strip — replaces the anonymous hero on the logged-in
   homepage. Handoff §6.2. All copy is derived from the mock user. */
export default function WelcomeStrip({ user }: WelcomeStripProps) {
  return (
    <section className={styles.strip}>
      <div className={styles.left}>
        <ConicAvatar size={56} letter={user.avatarLetter} ariaHidden />
        <div>
          <div className={styles.greet}>
            你好，<span className={styles.name}>{user.displayName}</span>。
          </div>
          <div className={styles.meta}>
            连续登陆 {user.streakDays} 天 · 上一次拆弹 {user.lastDefuse} · 本周 #{user.weekRank}
          </div>
        </div>
      </div>

      <div className={styles.stats}>
        <div className={styles.stat}>
          <div className={styles.value}>
            {user.streakDays}
            <small className={styles.unit}>天</small>
          </div>
          <div className={styles.label}>连胜</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.value}>{user.completed}</div>
          <div className={styles.label}>已完成</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.value}>#{user.weekRank}</div>
          <div className={styles.label}>本周排名</div>
        </div>
      </div>
    </section>
  )
}
