import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { PlanetOrb } from '@amiclaw/ui'
import type { CompanionIdentity } from '@shared/companion-types'
import type { DockStatus } from '@shared/companion-presence'
import { statusPhrase } from '@shared/companion-presence'
import {
  useCompanionPresence,
  type CompanionPresence as CompanionPresenceState,
} from './useCompanionPresence'
import { useMemoryHook } from './useMemoryHook'
import { LOBBY_VOICE_CAPABLE } from './lobby-voice'
import dockStyles from './CompanionDock.module.css'
import styles from './CompanionPresence.module.css'

/**
 * CompanionPresence — the platform's per-context companion presence system
 * (DesignSystem.md §Companion Presence). One component, three contexts:
 *
 *  - `shell`    the elevated presence card that leads the logged-in home's
 *               first screen: breathing PlanetOrb avatar + name + status +
 *               memory hook + labeled ≥48px talk button. The #1 discoverability
 *               fix for the voice companion.
 *  - `in-game`  the restrained thin strip (the persistent chrome dock): orb
 *               shrinks to a breathing dot, no memory hook, compact mic ≥44px.
 *               Preserves today's cognitive-load discipline while playing.
 *  - `create`   the「创建你的伙伴 →」onboarding entry (signed-in, no companion).
 *
 * The `shell` / `in-game` contexts drive the SAME voice state
 * (`useCompanionPresence`) and the same mute/restore controls — this batch
 * changes presentation and discoverability, not the voice pipeline.
 */

export type CompanionContext = 'shell' | 'in-game' | 'create'
export type CompanionPlacement = 'shell' | 'dock'

interface CompanionPresenceProps {
  context: CompanionContext
  /** Required for `shell` / `in-game`. */
  companion?: CompanionIdentity
  /** `create` only — in-flow (shell) vs the fixed bottom strip (dock). */
  placement?: CompanionPlacement
}

const LONG_PRESS_MS = 500

/** Short status word for the shell heading (name is shown separately). */
function statusWord(status: DockStatus): string {
  switch (status) {
    case 'listening':
      return '在听…'
    case 'speaking':
      return '说话中'
    case 'muted':
      return '静音中'
    default:
      return '在这'
  }
}

/**
 * Talk-affordance aria label — honest per `LOBBY_VOICE_CAPABLE`. While lobby
 * voice is off, the button opens the honest in-game-voice note, so labelling it
 * 开启/关闭语音 would imply a live lobby channel that does not exist.
 */
function micAriaLabel(status: DockStatus): string {
  if (!LOBBY_VOICE_CAPABLE) return '语音陪伴说明'
  return status === 'muted' ? '开启语音' : '关闭语音'
}

/** Visible talk-button text (shell context) — honest per capability. */
function talkText(status: DockStatus): string {
  if (!LOBBY_VOICE_CAPABLE) return '语音陪伴'
  return status === 'muted' ? '说话' : '关闭语音'
}

function MicGlyph({ muted, size = 18 }: { muted: boolean; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11 a7 7 0 0 0 14 0 M12 18 V21 M9 21 H15" />
      {muted && <path d="M4 4 L20 20" />}
    </svg>
  )
}

/** Mute / restore control menu — shared shape, class set supplied per context. */
function ControlMenu({
  presence,
  onClose,
  classes,
}: {
  presence: CompanionPresenceState
  onClose: () => void
  classes: { menu: string; menuItem: string }
}) {
  return (
    <div className={classes.menu} role="menu" aria-label="伙伴控制">
      <button
        type="button"
        role="menuitem"
        className={classes.menuItem}
        onClick={() => {
          presence.onMute()
          onClose()
        }}
      >
        静音
      </button>
      <button
        type="button"
        role="menuitem"
        className={classes.menuItem}
        onClick={() => {
          presence.onRestoreVoice()
          onClose()
        }}
      >
        恢复自动语音
      </button>
    </div>
  )
}

/** Menu open/close state + outside-close + long-press-to-open (shared). */
function useControlMenu() {
  const [menuOpen, setMenuOpen] = useState(false)
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

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
  return { menuOpen, setMenuOpen, menuRef, startLongPress, cancelLongPress }
}

// --- shell (elevated) --------------------------------------------------------

function ShellPresence({ companion }: { companion: CompanionIdentity }) {
  const presence = useCompanionPresence(companion)
  const { dockStatus, bubble } = presence
  // Memory hook stays quiet while muted (a muted companion doesn't surface
  // proactive warmth — mirrors the no-greeting-while-muted rule).
  const memory = useMemoryHook(dockStatus !== 'muted')
  const { menuOpen, setMenuOpen, menuRef, startLongPress, cancelLongPress } = useControlMenu()

  // ONE secondary line, never stacked: the live utterance (greeting / subtitle)
  // wins while it dwells; otherwise the restrained memory hook.
  const liveUtterance = bubble?.text ?? null
  const secondaryText = liveUtterance ?? memory.text
  const showDismiss = liveUtterance === null && memory.text !== null

  return (
    <section className={styles.shell} aria-label="伙伴在场" data-status={dockStatus}>
      <div ref={menuRef} style={{ position: 'relative', flex: 'none', lineHeight: 0 }}>
        <button
          type="button"
          className={styles.orbTrigger}
          onClick={() => setMenuOpen((open) => !open)}
          onPointerDown={startLongPress}
          onPointerUp={cancelLongPress}
          onPointerLeave={cancelLongPress}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={`${companion.name} 控制菜单`}
        >
          <PlanetOrb variant="avatar" size={52} ariaHidden />
        </button>
        {menuOpen && (
          <ControlMenu
            presence={presence}
            onClose={() => setMenuOpen(false)}
            classes={{ menu: styles.menu, menuItem: styles.menuItem }}
          />
        )}
      </div>

      <div className={styles.body}>
        <div className={styles.heading}>
          <span className={styles.name}>{companion.name}</span>
          <span className={styles.statusWord}>{statusWord(dockStatus)}</span>
        </div>
        {secondaryText !== null && (
          <div className={styles.secondary}>
            <span className={styles.secondaryText} role="status">
              {secondaryText}
            </span>
            {showDismiss && (
              <button
                type="button"
                className={styles.dismiss}
                onClick={memory.dismiss}
                aria-label="收起这条"
              >
                <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                  <path
                    d="M4 4 L12 12 M12 4 L4 12"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            )}
          </div>
        )}
      </div>

      <button
        type="button"
        className={styles.talk}
        data-status={dockStatus}
        onClick={presence.onMicClick}
        aria-label={micAriaLabel(dockStatus)}
      >
        <MicGlyph muted={dockStatus === 'muted'} />
        <span className={styles.talkLabel}>{talkText(dockStatus)}</span>
      </button>
    </section>
  )
}

// --- in-game (restrained strip) ----------------------------------------------

function InGamePresence({ companion }: { companion: CompanionIdentity }) {
  const presence = useCompanionPresence(companion)
  const { menuOpen, setMenuOpen, menuRef, startLongPress, cancelLongPress } = useControlMenu()

  const { dockStatus, bubble, lastUtterance } = presence
  // The muted status phrase and the live listening cue win over the last
  // utterance; otherwise the strip line carries the companion's most recent
  // words (design §状态机 坞内文字 column).
  const line =
    dockStatus === 'muted' || dockStatus === 'listening'
      ? statusPhrase(dockStatus, companion.name)
      : (lastUtterance ?? statusPhrase(dockStatus, companion.name))

  return (
    <>
      {bubble && (
        <div className={dockStyles.bubbleLayer}>
          <button
            type="button"
            className={`${dockStyles.bubble} ${bubble.expanded ? dockStyles.bubbleExpanded : ''}`}
            onClick={bubble.expanded ? presence.dismissBubble : presence.expandBubble}
            aria-label={bubble.expanded ? '收起伙伴的话' : '展开伙伴的话'}
          >
            <span className={dockStyles.bubbleName}>{companion.name}</span>
            <span className={dockStyles.bubbleText}>{bubble.text}</span>
          </button>
        </div>
      )}
      <aside className={dockStyles.dock} aria-label="伙伴坞" data-status={dockStatus}>
        <div className={dockStyles.nameRegion} ref={menuRef}>
          <button
            type="button"
            className={dockStyles.nameButton}
            onClick={() => setMenuOpen((open) => !open)}
            onPointerDown={startLongPress}
            onPointerUp={cancelLongPress}
            onPointerLeave={cancelLongPress}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={`${companion.name} 控制菜单`}
          >
            <span className={dockStyles.pulseDot} data-status={dockStatus} aria-hidden="true" />
            <span className={dockStyles.name}>{companion.name}</span>
          </button>
          {menuOpen && (
            <ControlMenu
              presence={presence}
              onClose={() => setMenuOpen(false)}
              classes={{ menu: dockStyles.menu, menuItem: dockStyles.menuItem }}
            />
          )}
        </div>
        <button
          type="button"
          className={dockStyles.textRegion}
          onClick={presence.reopenBubble}
          disabled={lastUtterance === null}
          aria-label={lastUtterance === null ? undefined : '回看伙伴的话'}
        >
          <span className={dockStyles.textLine} role="status">
            {line}
          </span>
        </button>
        <button
          type="button"
          className={dockStyles.micButton}
          data-status={dockStatus}
          onClick={presence.onMicClick}
          aria-label={micAriaLabel(dockStatus)}
        >
          <MicGlyph muted={dockStatus === 'muted'} />
        </button>
      </aside>
      <div className={dockStyles.spacer} aria-hidden="true" />
    </>
  )
}

// --- create (onboarding entry) -----------------------------------------------

function CreateEntry({ placement }: { placement: CompanionPlacement }) {
  if (placement === 'shell') {
    return (
      <section className={styles.createShell} aria-label="伙伴在场">
        <div className={styles.createShellCopy}>
          <div className={styles.createShellTitle}>你的 AI 伙伴还没上线</div>
          <div className={styles.createShellSub}>取个名字，选个声音，之后每一局都有它陪着。</div>
        </div>
        <Link to="/me/companion" className={styles.createShellCta}>
          创建你的伙伴 →
        </Link>
      </section>
    )
  }
  return (
    <>
      <aside className={dockStyles.dock} aria-label="伙伴坞" data-status="setup">
        <Link to="/me/companion" className={dockStyles.createEntry}>
          创建你的伙伴 →
        </Link>
      </aside>
      <div className={dockStyles.spacer} aria-hidden="true" />
    </>
  )
}

// --- router ------------------------------------------------------------------

export default function CompanionPresence({
  context,
  companion,
  placement = context === 'shell' ? 'shell' : 'dock',
}: CompanionPresenceProps) {
  if (context === 'create') return <CreateEntry placement={placement} />
  if (!companion) return null
  if (context === 'shell') return <ShellPresence companion={companion} />
  return <InGamePresence companion={companion} />
}
