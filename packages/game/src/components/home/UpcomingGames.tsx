import Chip from '@/components/ui/Chip'
import SectionHeader from '@/components/ui/SectionHeader'
import { type GameStatus, upcomingGames } from '@/mocks/upcoming-games'
import styles from './UpcomingGames.module.css'

/* Chinese label for each game-status badge — handoff §6.6. */
const STATUS_LABEL: Record<GameStatus, string> = {
  soon: '即将上线',
  dev: '开发中',
  live: '可玩',
}

/* Upcoming-games section — handoff §6.6. A three-up grid of game tiles;
   each art panel is a CSS radial-gradient placeholder keyed by the
   game's `artVariant`. Platform chrome — no cyan. */
export default function UpcomingGames() {
  return (
    <section className={styles.section}>
      <SectionHeader eyebrow="即将上线 · IN ORBIT" title="下一批游戏。" />
      <div className={styles.grid}>
        {upcomingGames.map((game) => {
          const isLab = game.artVariant === 'lab'
          /* echo / draw show the game's Chinese name; Game Lab shows a
             bespoke Latin-flavored label, matching the atlas.html
             prototype. The .cn modifier swaps in Noto Sans SC. */
          const artLabel = isLab ? 'Lab · 提案中' : game.name
          const artLabelClass = isLab ? styles.artLabel : `${styles.artLabel} ${styles.artLabelCn}`
          return (
            <article key={game.id} className={styles.tile}>
              <div className={`${styles.art} ${styles[game.artVariant]}`}>
                <div className={artLabelClass}>{artLabel}</div>
              </div>
              <h5 className={styles.name}>
                <span>{game.name}</span>
                <Chip variant={game.status}>{STATUS_LABEL[game.status]}</Chip>
              </h5>
              <p className={styles.blurb}>{game.blurb}</p>
            </article>
          )
        })}
      </div>
    </section>
  )
}
