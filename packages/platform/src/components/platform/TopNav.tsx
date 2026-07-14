import { Link, NavLink } from 'react-router-dom'
import { ConicAvatar, Wordmark } from '@amiclaw/ui'
import { useAuth } from '@/hooks/useAuth'
import BalanceChip from './BalanceChip'
import { NAV_TABS } from './nav-tabs'
import styles from './TopNav.module.css'

/* Sticky platform navigation — brand mark, 4 center tabs, right auth slot.
   On mobile (≤768px) the center tabs are hidden; BottomNav restores them. */
export default function TopNav() {
  const { status, user } = useAuth()

  return (
    <div className={styles.wrap}>
      <div className={styles.nav}>
        <Link to="/" className={styles.brand}>
          <Wordmark variant="lockup" className={styles.brandMark} />
        </Link>

        <nav className={styles.links} aria-label="主导航">
          {NAV_TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.to === '/'}
              className={({ isActive }) =>
                isActive ? `${styles.link} ${styles.active}` : styles.link
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>

        <div className={styles.right}>
          {/* The session read is async. While `loading`, the right slot is
              held empty so signed-out chrome never flashes and snaps to the
              avatar once a session resolves. */}
          {status === 'loading' ? null : status === 'authed' && user ? (
            <>
              {/* The starburst balance chip sits left of the avatar, authed
                  only; it holds itself empty until its own read resolves, so
                  the slot never flashes a broken pill (reward-economy §7). */}
              <BalanceChip />
              <Link to="/me" className={styles.avatarLink} aria-label="我的">
                <ConicAvatar size={36} spin letter={user.avatarLetter} ariaHidden />
              </Link>
            </>
          ) : (
            /* Signed-out: a single primary 登录 / 注册 entry to the magic-link
               /login page. Magic-link is passwordless — first-time verify
               auto-creates the account — so one control honestly covers both
               sign-in and sign-up; there is no separate register flow. The
               nav carries NO play CTA: anonymous mode① play is reached from
               the homepage hero / BombSquad card, so login is never forced. */
            <Link to="/login" className={styles.loginBtn}>
              登录 / 注册
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
