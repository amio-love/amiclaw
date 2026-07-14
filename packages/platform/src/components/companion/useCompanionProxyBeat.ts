/**
 * 甲-side proxy transparency beat (spec §Mechanism V1 + §Variant 3).
 *
 * When 甲 is logged in and present in the lobby with a companion, the client
 * fires the V1 background trigger BEST-EFFORT once per page-load session (a
 * module-level guard, NOT a server idempotency key — the real per-day / burst
 * boundary is server-side). On a `messaged:true` response the companion has
 * autonomously left a public line, so this hook surfaces a single dismissible
 * transparency line built from the returned `target_event` — no second feed
 * read. It is a new beat under the proactivity model's "single dismissible line,
 * never stacked" discipline: it neither interrupts nor conceals.
 */
import { useEffect, useState } from 'react'
import { triggerCompanionProxyMessage, type ProxyMessageTargetEvent } from '@/lib/proxy-social-api'

export interface ProxyBeatLine {
  /** The transparency copy (one of the three template variants). */
  text: string
  /** Where 「→ 看看我说了什么」 routes — the community feed anchored at the exact
      event (`/community?event=<event_id>`), so the just-authored thread scrolls
      into view on arrival. */
  href: string
}

/**
 * Fill the transparency line from real target-event facts (spec §Variant 3
 * table). `<乙>` is the target's public label; every clause is backed by the
 * returned facts — no fabricated content.
 */
export function buildProxyBeatText(target: ProxyMessageTargetEvent): string {
  const who = target.target_public_label
  switch (target.template) {
    case 'daily_clear':
      return `我看到 ${who} 拆掉了今天的每日挑战，替你道了句漂亮`
    case 'leaderboard_entry':
      return `我看到 ${who} 登上了连续打卡榜，替你送了句祝贺`
    case 'streak_milestone':
      return `我看到 ${who} 连续打卡到了第 ${target.streak_days ?? 0} 天，替你道了句佩服`
  }
}

// Module-level so the trigger fires at most once per page-load session across
// route changes / remounts (best-effort client throttle — spec §Mechanism V1).
let sessionTriggered = false

/** Test-only: reset the once-per-session guard between cases. */
export function __resetProxyBeatSession(): void {
  sessionTriggered = false
}

export interface CompanionProxyBeatState {
  /** The transparency line, or null while none is live / after dismissal. */
  line: ProxyBeatLine | null
  /** Hide the line for this session (a tap on its ✕ or the 查看 link). */
  dismiss: () => void
}

export function useCompanionProxyBeat(enabled: boolean): CompanionProxyBeatState {
  const [line, setLine] = useState<ProxyBeatLine | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!enabled || sessionTriggered) return
    sessionTriggered = true
    let active = true
    // Set state only in the async continuation, never synchronously in the
    // effect body — the react-hooks/set-state-in-effect discipline.
    void triggerCompanionProxyMessage().then((result) => {
      if (!active) return
      if (result.kind === 'messaged') {
        setLine({
          text: buildProxyBeatText(result.targetEvent),
          href: `/community?event=${encodeURIComponent(result.targetEvent.event_id)}`,
        })
      }
    })
    return () => {
      active = false
    }
  }, [enabled])

  const dismiss = () => setDismissed(true)
  if (dismissed) return { line: null, dismiss }
  return { line, dismiss }
}
