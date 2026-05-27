import { Outlet } from 'react-router-dom'
import { Scenery } from '@amiclaw/ui'
import TopNav from './TopNav'
import BottomNav from './BottomNav'
import PlatformFooter from './PlatformFooter'
import styles from './PlatformLayout.module.css'

/* Layout route for the 4 platform pages (/、/leaderboard、/community、/me).
   Owns the cosmic gradient background — applied to this root element, NOT
   <body>, so the BombSquad game routes keep global.css's #1a1a2e. */
export default function PlatformLayout() {
  return (
    <div className={styles.root}>
      <Scenery />
      <TopNav />
      <main className={styles.page}>
        <Outlet />
      </main>
      <PlatformFooter />
      <BottomNav />
    </div>
  )
}
