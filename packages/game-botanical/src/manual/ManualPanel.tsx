import styles from './ManualPanel.module.css'
import type { RenderedManual } from './render-manual'

interface ManualPanelProps {
  manual: RenderedManual
}

/* Dev-viewable botanist manual surface — renders the RenderedManual as HTML.
   In hidden_info_coop the shipped player is the gardener and does NOT read
   this; it is the botanist-side / inspection view (reachable at /manual). */
export default function ManualPanel({ manual }: ManualPanelProps) {
  return (
    <article className={styles.panel} aria-label="养护手册">
      <header className={styles.head}>
        <h1 className={styles.title}>养护手册</h1>
        <span className={styles.version}>v{manual.version}</span>
      </header>
      {manual.sections.map((section) => (
        <section key={section.id} className={styles.section} data-section-id={section.id}>
          <h2 className={styles.sectionTitle}>{section.title}</h2>
          <ul className={styles.lines}>
            {section.lines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </section>
      ))}
    </article>
  )
}
