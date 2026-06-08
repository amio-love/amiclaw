import { Link } from 'react-router-dom'
import { ConicAvatar, EyebrowTag, GlassCard } from '@amiclaw/ui'
import { useAuth, type DisplayUser } from '@/hooks/useAuth'
import styles from './AccountPage.module.css'

/* Account page — handoff §6.11. Reads identity from useAuth():
     - loading → hold the page chrome only (no profile, no guide) so neither
       state flashes before the session resolves.
     - signed-in → the real-identity profile with an honest empty stats state.
     - anonymous → a login-guide empty state routing to /login.

   Platform chrome — every accent is brand yellow; no BombSquad cyan here. */
export default function AccountPage() {
  const { status, user } = useAuth()

  return (
    <div className={styles.page}>
      <EyebrowTag variant="section">我的 · ACCOUNT</EyebrowTag>
      {status === 'loading' ? null : status === 'authed' && user ? (
        <SignedInProfile user={user} />
      ) : (
        <SignedOutGuide />
      )}
    </div>
  )
}

/* The signed-in profile — identity is the real session's derived display name.

   Per-user stats (recent runs / badges / rank / streak) are NOT shown: real
   per-user stats need the leaderboard user_id migration (not yet built), and
   showing mock numbers to a real logged-in user would re-introduce the exact
   fake-data problem PR #133 fixed for the signed-out state. So the detail
   column is an honest empty state — "还没有成绩，去玩一局" with a play CTA —
   not mock numbers and not a「即将推出」placeholder. */
function SignedInProfile({ user }: { user: DisplayUser }) {
  return (
    <>
      <h2 className={styles.title}>
        <span className={styles.accent}>{user.displayName}</span> 的星轨。
      </h2>
      <p className={styles.lead}>你的战绩、连胜、个人最快记录。所有数据只属于你。</p>

      <div className={styles.grid}>
        <GlassCard radius="2xl" className={styles.profile}>
          <div className={styles.avatar}>
            <ConicAvatar size={96} letter={user.avatarLetter} ariaHidden />
          </div>
          <div className={styles.name}>{user.displayName}</div>
          <div className={styles.rank}>{user.email}</div>
        </GlassCard>

        <div className={styles.detail}>
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>战绩</h3>
            <GlassCard radius="2xl" className={styles.emptyCard}>
              <p className={styles.emptyText}>还没有成绩，去玩一局。</p>
              <a className={styles.emptyCta} href="/bombsquad/">
                开始玩
              </a>
            </GlassCard>
          </section>
        </div>
      </div>
    </>
  )
}

/* What signing in unlocks — plain text only. No fake numbers, names, or a
   blurred/skeleton fake-data placeholder; the anonymous visitor must never
   see another user's stats here. */
const UNLOCK_PREVIEW = ['战绩与单局完成率', '连胜与最快记录', '勋章墙']

/* The anonymous empty state — a single login-guide card. Routes to the
   magic-link /login page via react-router. */
function SignedOutGuide() {
  return (
    <>
      <h2 className={styles.title}>登录后查看你的星轨。</h2>
      <p className={styles.lead}>登录后，这里会显示属于你的战绩、连胜和勋章。</p>

      <GlassCard radius="2xl" className={styles.guideCard}>
        <h3 className={styles.guideTitle}>登录后查看你的星轨</h3>
        <ul className={styles.unlockList}>
          {UNLOCK_PREVIEW.map((item) => (
            <li key={item} className={styles.unlockItem}>
              {item}
            </li>
          ))}
        </ul>
        <Link to="/login" className={styles.guideCta}>
          登录
        </Link>
      </GlassCard>
    </>
  )
}
