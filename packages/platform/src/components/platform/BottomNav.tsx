import { NavLink } from 'react-router-dom'
import { NAV_TABS } from './nav-tabs'
import styles from './BottomNav.module.css'

/* Mobile (≤768px) bottom tab bar — restores the 4-tab platform nav that
   TopNav hides on small screens. Hidden ≥769px. Text tabs, no icons. */
export default function BottomNav() {
  return (
    <nav className={styles.bar} aria-label="移动端导航">
      {NAV_TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.to === '/'}
          className={({ isActive }) => (isActive ? `${styles.tab} ${styles.active}` : styles.tab)}
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  )
}
