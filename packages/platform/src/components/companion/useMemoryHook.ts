/**
 * Shell-presence memory-hook slot (companion-presence §记忆钩子槽).
 *
 * Frontend-only: draws its one warm line from the episodic layer already
 * reachable via the companion memory album (`GET /api/companion/memories`, the
 * same read the arrival greeting uses). The most recent visible episode's title
 * backs the line; a companion with no shared history falls to the gentle
 * first-meeting empty state. No new endpoint, no schema change.
 *
 * Restraint (design guardrail): one quiet line, dismissible for the session —
 * never a stacked notification.
 */
import { useEffect, useState } from 'react'
import { buildMemoryHook } from '@shared/companion-presence'
import { fetchMemories } from '@/lib/companion-api'

export interface MemoryHook {
  /** The one-line hook, or null before it resolves / after dismissal. */
  text: string | null
  /** Hide it for this session (a tap on the line's dismiss control). */
  dismiss: () => void
}

export function useMemoryHook(enabled: boolean): MemoryHook {
  const [recentTitle, setRecentTitle] = useState<string | null>(null)
  const [resolved, setResolved] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let active = true
    // Set state only in the async continuation (never synchronously in the
    // effect body) — the react-hooks/set-state-in-effect discipline.
    void fetchMemories().then((result) => {
      if (!active) return
      const title =
        result.kind === 'ok' && result.memories.length > 0
          ? (result.memories[0]?.title ?? null)
          : null
      setRecentTitle(title)
      setResolved(true)
    })
    return () => {
      active = false
    }
  }, [enabled])

  const dismiss = () => setDismissed(true)
  if (!enabled || !resolved || dismissed) return { text: null, dismiss }
  return { text: buildMemoryHook(recentTitle), dismiss }
}
