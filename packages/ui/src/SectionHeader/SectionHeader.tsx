import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import EyebrowTag from '../EyebrowTag'
import styles from './SectionHeader.module.css'

/* Class for the yellow-italic accent fragment inside a section title.
   Callers inline it: title={<>Foo · <span className={accentClass}>Bar</span></>} */
export const accentClass = styles.accent

interface SectionHeaderAction {
  label: string
  to?: string
  onClick?: () => void
}

interface SectionHeaderProps {
  /* Plain string for the usual uppercase eyebrow, or a ReactNode when a
     fragment must opt out of the eyebrow's `text-transform: uppercase` —
     e.g. a `<Wordmark />` keeping the brand name in prose case. */
  eyebrow: ReactNode
  title: ReactNode
  action?: SectionHeaderAction
}

/* Section header — eyebrow + title, with an optional right-aligned
   action pill (a router Link when `to` is set, else a button). */
export default function SectionHeader({ eyebrow, title, action }: SectionHeaderProps) {
  return (
    <div className={styles.head}>
      <div className={styles.headMain}>
        <EyebrowTag variant="section">{eyebrow}</EyebrowTag>
        <h3 className={styles.title}>{title}</h3>
      </div>
      {action &&
        (action.to ? (
          <Link to={action.to} className={styles.action}>
            {action.label}
          </Link>
        ) : (
          <button type="button" className={styles.action} onClick={action.onClick}>
            {action.label}
          </button>
        ))}
    </div>
  )
}
