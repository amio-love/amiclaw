import { useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useCompanion } from '@/hooks/useCompanion'
import CompanionPresence from './CompanionPresence'
import styles from './CompanionDock.module.css'

/**
 * CompanionDock — the persistent bottom presence chrome. It hosts the
 * restrained `in-game` context of CompanionPresence (a 48px strip pinned above
 * the tab bar) on every platform page EXCEPT the logged-in home.
 *
 * On the home route the companion presence is ELEVATED to the top of the first
 * screen (WelcomeStrip hosts the `shell` context — DesignSystem.md §Companion
 * Presence), so the dock stands down to a clearance spacer here. Rendering the
 * strip too would mean a SECOND mounted presence — a duplicate arrival greeting
 * and a duplicate voice session — so only one presence is ever live per page.
 *
 * Anonymous visitors see nothing (an honest empty slot); a signed-in player
 * without a companion sees the 「创建你的伙伴 →」 entry; an identity read error is
 * an honest absence.
 */
export default function CompanionDock() {
  const auth = useAuth()
  const { state } = useCompanion(auth.status === 'authed')
  const onHome = useLocation().pathname === '/'

  if (auth.status !== 'authed') return null
  // Home elevates the presence to the top; keep only the bottom clearance so
  // page content still clears the fixed BottomNav on this route.
  if (onHome) return <div className={styles.spacer} aria-hidden="true" />
  if (state.status === 'none') return <CompanionPresence context="create" />
  if (state.status !== 'exists') return null
  return <CompanionPresence context="in-game" companion={state.companion} />
}
