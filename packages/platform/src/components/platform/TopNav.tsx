import { Link, NavLink } from 'react-router-dom'
import { Button, ConicAvatar, Wordmark } from '@amiclaw/ui'
import { useAuth } from '@/hooks/useAuth'
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
            <Link to="/me" className={styles.avatarLink} aria-label="我的">
              <ConicAvatar size={36} spin letter={user.avatarLetter} ariaHidden />
            </Link>
          ) : (
            /* Signed-out, mode②/point-of-need entry: a primary 开始玩 CTA into
               the BombSquad SPA (window.location.assign('/bombsquad/'), the
               same cross-app entry every play CTA uses) plus a 登录 link to
               the magic-link /login page. mode① anonymous direct-play is
               untouched — login is never forced. */
            <>
              <Link to="/login" className={styles.loginLink}>
                登录
              </Link>
              <Button
                variant="primary"
                size="sm"
                onClick={() => window.location.assign('/bombsquad/')}
              >
                开始玩
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
