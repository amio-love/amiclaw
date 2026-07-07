import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { CompanionIdentity } from '@shared/companion-types'
import type { DockStatus } from '@shared/companion-presence'
import { useAuth } from '@/hooks/useAuth'
import { useCompanion } from '@/hooks/useCompanion'
import { useCompanionPresence } from './useCompanionPresence'
import { LOBBY_VOICE_CAPABLE } from './lobby-voice'
import styles from './CompanionDock.module.css'

/**
 * 伙伴坞 — the persistent companion presence bar (companion-presence-design
 * §存在层). A 48px strip pinned above the tab bar on every platform page:
 * name + breathing pulse dot (the entire visual presence signal — no avatar,
 * no face), the one-line text region, and the mic button. Anonymous visitors
 * see nothing; a signed-in player without a companion sees the
 * 「创建你的伙伴 →」 entry into onboarding.
 *
 * The dock also renders the floating utterance bubble (proactive beats land
 * there, dwell 5s, then collapse into the text line) and the control menu
 * (静音 / 恢复自动语音 — opened from the name region by click or long-press).
 */

const LONG_PRESS_MS = 500

/** Dock-line status phrases (design §状态机 坞内文字 column). */
function statusPhrase(status: DockStatus, name: string): string {
  switch (status) {
    case 'listening':
      return '在听…'
    case 'muted':
      return `${name}在这（静音中）`
    default:
      return `${name}在这`
  }
}

function micAriaLabel(status: DockStatus): string {
  // While lobby voice is off the button opens the honest in-game-voice note —
  // labelling it 开启/关闭语音 would imply a live lobby voice channel.
  if (!LOBBY_VOICE_CAPABLE) return '语音陪伴说明'
  return status === 'muted' ? '开启语音' : '关闭语音'
}

function ActiveDock({ companion }: { companion: CompanionIdentity }) {
  const presence = useCompanionPresence(companion)
  const [menuOpen, setMenuOpen] = useState(false)
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  // Close the menu on any outside pointerdown.
  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [menuOpen])

  const startLongPress = () => {
    longPressRef.current = setTimeout(() => setMenuOpen(true), LONG_PRESS_MS)
  }
  const cancelLongPress = () => {
    if (longPressRef.current) {
      clearTimeout(longPressRef.current)
      longPressRef.current = null
    }
  }

  const { dockStatus, bubble, lastUtterance } = presence
  // The muted status phrase (「X在这（静音中）」) and the live listening cue win
  // over the last-utterance summary; otherwise the dock line carries the
  // companion's most recent words (design §状态机 坞内文字 column).
  const line =
    dockStatus === 'muted' || dockStatus === 'listening'
      ? statusPhrase(dockStatus, companion.name)
      : (lastUtterance ?? statusPhrase(dockStatus, companion.name))

  return (
    <>
      {bubble && (
        <div className={styles.bubbleLayer}>
          <button
            type="button"
            className={`${styles.bubble} ${bubble.expanded ? styles.bubbleExpanded : ''}`}
            onClick={bubble.expanded ? presence.dismissBubble : presence.expandBubble}
            aria-label={bubble.expanded ? '收起伙伴的话' : '展开伙伴的话'}
          >
            <span className={styles.bubbleName}>{companion.name}</span>
            <span className={styles.bubbleText}>{bubble.text}</span>
          </button>
        </div>
      )}
      <aside className={styles.dock} aria-label="伙伴坞" data-status={dockStatus}>
        <div className={styles.nameRegion} ref={menuRef}>
          <button
            type="button"
            className={styles.nameButton}
            onClick={() => setMenuOpen((open) => !open)}
            onPointerDown={startLongPress}
            onPointerUp={cancelLongPress}
            onPointerLeave={cancelLongPress}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={`${companion.name} 控制菜单`}
          >
            <span className={styles.pulseDot} data-status={dockStatus} aria-hidden="true" />
            <span className={styles.name}>{companion.name}</span>
          </button>
          {menuOpen && (
            <div className={styles.menu} role="menu" aria-label="伙伴控制">
              <button
                type="button"
                role="menuitem"
                className={styles.menuItem}
                onClick={() => {
                  presence.onMute()
                  setMenuOpen(false)
                }}
              >
                静音
              </button>
              <button
                type="button"
                role="menuitem"
                className={styles.menuItem}
                onClick={() => {
                  presence.onRestoreVoice()
                  setMenuOpen(false)
                }}
              >
                恢复自动语音
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          className={styles.textRegion}
          onClick={presence.reopenBubble}
          disabled={lastUtterance === null}
          aria-label={lastUtterance === null ? undefined : '回看伙伴的话'}
        >
          <span className={styles.textLine} role="status">
            {line}
          </span>
        </button>
        <button
          type="button"
          className={styles.micButton}
          data-status={dockStatus}
          onClick={presence.onMicClick}
          aria-label={micAriaLabel(dockStatus)}
        >
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <rect x="9" y="3" width="6" height="12" rx="3" />
            <path d="M5 11 a7 7 0 0 0 14 0 M12 18 V21 M9 21 H15" />
            {dockStatus === 'muted' && <path d="M4 4 L20 20" />}
          </svg>
        </button>
      </aside>
      <div className={styles.spacer} aria-hidden="true" />
    </>
  )
}

function CreateEntryDock() {
  return (
    <>
      <aside className={styles.dock} aria-label="伙伴坞" data-status="setup">
        <Link to="/me/companion" className={styles.createEntry}>
          创建你的伙伴 →
        </Link>
      </aside>
      <div className={styles.spacer} aria-hidden="true" />
    </>
  )
}

/**
 * Host: resolves auth + companion identity and renders the matching dock
 * variant. Renders nothing while loading (no signed-out flash), for anonymous
 * visitors (design §匿名态 — the dock's slot is simply empty), and on an
 * identity read error (an honest absence beats a wrong presence).
 */
export default function CompanionDock() {
  const auth = useAuth()
  const { state } = useCompanion(auth.status === 'authed')

  if (auth.status !== 'authed') return null
  if (state.status === 'none') return <CreateEntryDock />
  if (state.status !== 'exists') return null
  return <ActiveDock companion={state.companion} />
}
