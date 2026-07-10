import type { ReactNode } from 'react'
import styles from './PageHeader.module.css'

interface PageHeaderProps {
  /* Back affordance slot — typically a <BackLink variant="inline" />. */
  back?: ReactNode
  /* Optional eyebrow slot — typically an <EyebrowTag variant="section" />. */
  eyebrow?: ReactNode
  title: ReactNode
  /* Optional supporting lead paragraph under the title. */
  lead?: ReactNode
  className?: string
}

/* Shared stacked section header — an optional back link, an optional eyebrow, a
   title, and an optional lead. One source for the platform's nested-page
   headers (was the bespoke CompanionPageHeader markup). */
export default function PageHeader({ back, eyebrow, title, lead, className }: PageHeaderProps) {
  const classes = [styles.header, className].filter(Boolean).join(' ')
  return (
    <header className={classes}>
      {back ? <div className={styles.back}>{back}</div> : null}
      {eyebrow}
      <h2 className={styles.title}>{title}</h2>
      {lead ? <p className={styles.lead}>{lead}</p> : null}
    </header>
  )
}
