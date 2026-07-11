import { Button, ConicAvatar } from '@amiclaw/ui'
import type { DisplayUser } from '@/hooks/useAuth'
import { useCompanion } from '@/hooks/useCompanion'
import { useGreetingName } from '@/hooks/useGreetingName'
import CompanionPresence from '@/components/companion/CompanionPresence'
import styles from './WelcomeStrip.module.css'

interface WelcomeStripProps {
  user: DisplayUser
}

/* Signed-in home header — the host of the elevated companion presence
   (DesignSystem.md §Companion Presence; rc §2.2). The logged-in home's first
   screen leads with the companion: an existing companion shows the `shell`
   presence bar (breathing orb + name + status + memory hook + talk button); a
   signed-in player without one sees the `create` entry. While the identity read
   is in flight (or errors) the strip degrades to a neutral name greeting so the
   first screen is never blank and never claims a companion it can't read. */
export default function WelcomeStrip({ user }: WelcomeStripProps) {
  const { state } = useCompanion(true)

  if (state.status === 'exists') {
    // The presence bar leads the first screen; a slim play entry rides just
    // below it so the signed-in home keeps its one-tap into a game (the old
    // WelcomeStrip 开始玩 CTA — the play flow is preserved, not removed).
    return (
      <div className={styles.host}>
        <CompanionPresence context="shell" companion={state.companion} />
        <div className={styles.playRow}>
          <Button variant="primary" size="sm" onClick={() => window.location.assign('/bombsquad/')}>
            开始玩
          </Button>
        </div>
      </div>
    )
  }
  if (state.status === 'none') {
    return <CompanionPresence context="create" placement="shell" />
  }
  return <GreetingFallback user={user} />
}

/* Neutral lead-in while the companion identity read is loading / errored. Greets
   the returning player by the unified username — the public leaderboard handle
   (ruling A), never the companion-given intimate name and never the account
   email (audit F19). This greeting is outside the companion context, so it uses
   the username, not the intimate name. Per-user stats stay honest: real
   per-user figures need the leaderboard user_id migration, so the right side is
   a play CTA, not fabricated numbers. */
function GreetingFallback({ user }: { user: DisplayUser }) {
  const greetingName = useGreetingName()
  return (
    <section className={styles.strip}>
      <div className={styles.left}>
        <ConicAvatar size={56} letter={user.avatarLetter} ariaHidden />
        <div>
          <div className={styles.greet}>
            {greetingName ? (
              <>
                你好，<span className={styles.name}>{greetingName}</span>。
              </>
            ) : (
              '你好。'
            )}
          </div>
          <div className={styles.meta}>还没有成绩，去玩一局，这里会记录你的战绩。</div>
        </div>
      </div>

      <Button variant="primary" size="sm" onClick={() => window.location.assign('/bombsquad/')}>
        开始玩
      </Button>
    </section>
  )
}
