import { Link } from 'react-router-dom'
import styles from './PlatformFooter.module.css'

/* Secondary footer links. 隐私 / 条款 route to their platform pages; 关于 and
   Discord have no destination yet (owned by a sibling task) and render as
   plain text until those pages land. */
const FOOTER_LINKS: { label: string; to?: string }[] = [
  { label: '关于' },
  { label: '隐私', to: '/privacy' },
  { label: '条款', to: '/terms' },
  { label: 'Discord' },
]

/* Platform footer — copyright line + secondary link row. */
export default function PlatformFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <span>© 2026 AMIO · amio.love</span>
        <div className={styles.links}>
          {FOOTER_LINKS.map(({ label, to }) =>
            to ? (
              <Link key={label} to={to} className={styles.link}>
                {label}
              </Link>
            ) : (
              <span key={label} className={styles.link}>
                {label}
              </span>
            )
          )}
        </div>
      </div>
    </footer>
  )
}
