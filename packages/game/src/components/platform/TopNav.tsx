import { Link, NavLink } from 'react-router-dom'
import Button from '@/components/ui/Button'
import ConicAvatar from '@/components/ui/ConicAvatar'
import { useAuth } from '@/hooks/useAuth'
import { NAV_TABS } from './nav-tabs'
import styles from './TopNav.module.css'

/* Sticky platform navigation — brand mark, 4 center tabs, right auth slot.
   On mobile (≤768px) the center tabs are hidden; BottomNav restores them. */
export default function TopNav() {
  const { signedIn, user } = useAuth()

  return (
    <div className={styles.wrap}>
      <div className={styles.nav}>
        <Link to="/" className={styles.brand}>
          <span className={styles.brandMark}>
            AMIO<span className={styles.dot}>·</span>claw
          </span>
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
          {signedIn ? (
            <Link to="/me" className={styles.avatarLink} aria-label="我的">
              <ConicAvatar size={36} spin letter={user?.avatarLetter} ariaHidden />
            </Link>
          ) : (
            <Button variant="primary" size="sm">
              登录 / 开始
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
