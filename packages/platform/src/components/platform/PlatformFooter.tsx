import styles from './PlatformFooter.module.css'

/* The secondary links have no destinations yet — the corresponding pages
   land in later phases, so they render as plain text for now. */
const FOOTER_LINKS = ['关于', '隐私', '条款', 'Discord']

/* Platform footer — copyright line + secondary link row. */
export default function PlatformFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <span>© 2026 AMIO · amio.love</span>
        <div className={styles.links}>
          {FOOTER_LINKS.map((label) => (
            <span key={label} className={styles.link}>
              {label}
            </span>
          ))}
        </div>
      </div>
    </footer>
  )
}
