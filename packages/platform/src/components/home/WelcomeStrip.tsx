import { Button, ConicAvatar } from '@amiclaw/ui'
import type { DisplayUser } from '@/hooks/useAuth'
import { useGreetingName } from '@/hooks/useGreetingName'
import styles from './WelcomeStrip.module.css'

interface WelcomeStripProps {
  user: DisplayUser
}

/* Signed-in welcome strip — replaces the anonymous hero on the logged-in
   homepage. Greets the real user by their derived display name.

   Per-user stats (streak / completed / rank) are NOT shown: real per-user
   stats need the leaderboard user_id migration (migrate-leaderboard-to-user-id,
   not yet built), and showing mock numbers to a real logged-in user would
   re-introduce the fake-data problem PR #133 fixed for the signed-out state.
   So the right side is an honest「还没有成绩」prompt with a play CTA, not
   fabricated figures and not a「即将推出」placeholder. */
export default function WelcomeStrip({ user }: WelcomeStripProps) {
  // Homepage welcome strip is a companion surface — the companion greets the
  // returning player here, and the lobby voice already calls them by the
  // relationship name. So greet companion-known name > board nickname > a
  // neutral greeting (F5), keeping the strip and the voice consistent. Never the
  // account email (audit F19). The avatar stays a decorative ariaHidden glyph.
  const greetingName = useGreetingName(true)
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
