import { Link } from 'react-router-dom'
import { EyebrowTag } from '@amiclaw/ui'
import styles from './CompanionPageHeader.module.css'

interface CompanionPageHeaderProps {
  /** Bilingual eyebrow, e.g. `回忆 · MEMORIES`. */
  eyebrow: string
  title: string
  lead?: string
}

/* Shared header for the nested /me/* companion pages — a back link to /me, the
   bilingual section eyebrow, a page title, and an optional lead. */
export default function CompanionPageHeader({ eyebrow, title, lead }: CompanionPageHeaderProps) {
  return (
    <header className={styles.header}>
      <Link to="/me" className={styles.back}>
        ← 我的
      </Link>
      <EyebrowTag variant="section">{eyebrow}</EyebrowTag>
      <h2 className={styles.title}>{title}</h2>
      {lead ? <p className={styles.lead}>{lead}</p> : null}
    </header>
  )
}
