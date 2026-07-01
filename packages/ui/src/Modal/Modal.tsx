import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import styles from './Modal.module.css'

interface ModalProps {
  /** Whether the modal is mounted + visible. */
  open: boolean
  /** Close request — backdrop click, Escape key, or the × button. */
  onClose: () => void
  /** Heading text; rendered as the dialog's accessible name. */
  title: string
  children: ReactNode
  className?: string
}

/* A centered glass dialog (role="dialog", aria-modal). Portalled to <body> so it
   stacks above the cosmic shell regardless of where it is rendered. Closes on
   Escape, on a backdrop click, or via the × control. CSS-only fade/scale entry;
   degrades to no transform under prefers-reduced-motion (see Modal.module.css).

   Uses only React's own hooks (no shared-module hook), so consumer barrel mocks
   of @amiclaw/ui are unaffected. */
export default function Modal({ open, onClose, title, children, className }: ModalProps) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    // Move focus into the dialog so keyboard + screen-reader users land inside.
    dialogRef.current?.focus()
    // Lock background scroll while the dialog owns the viewport.
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className={styles.backdrop} onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={[styles.dialog, className].filter(Boolean).join(' ')}
        // Clicks inside the dialog must not bubble to the backdrop's close.
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          <button type="button" className={styles.close} aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </div>
        <div className={styles.body}>{children}</div>
      </div>
    </div>,
    document.body
  )
}
