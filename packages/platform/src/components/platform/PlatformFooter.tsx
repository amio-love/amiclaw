import { Link } from 'react-router-dom'
import { DISCORD_INVITE_URL } from '@/config/links'
import styles from './PlatformFooter.module.css'

/* Secondary footer links — internal react-router routes only (隐私 / 条款).
   Discord is rendered separately as a conditional external link bound to the
   shared DISCORD_INVITE_URL sentinel (see below). */
const FOOTER_LINKS: { label: string; to: string }[] = [
  { label: '隐私', to: '/privacy' },
  { label: '条款', to: '/terms' },
]

/* Platform footer — copyright line + secondary link row. */
export default function PlatformFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <span>© 2026 AMIO · amio.love</span>
        <div className={styles.links}>
          {FOOTER_LINKS.map(({ label, to }) => (
            <Link key={label} to={to} className={styles.link}>
              {label}
            </Link>
          ))}
          {/* Honest-collapse: Discord appears only once the shared invite is
              configured; the empty-string sentinel renders nothing. */}
          {DISCORD_INVITE_URL && (
            <a
              href={DISCORD_INVITE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.link}
            >
              Discord
            </a>
          )}
        </div>
      </div>
    </footer>
  )
}
