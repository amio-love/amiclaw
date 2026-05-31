import { Chip, SectionHeader } from '@amiclaw/ui'
import { type GameStatus, type UpcomingGame, upcomingGames } from '@/mocks/upcoming-games'
import styles from './UpcomingGames.module.css'

/* Chinese label for each game-status badge — handoff §6.6.
   `preview` was added in the Yijing Oracle wiring (round 5): a playable
   prototype that lives at a sibling deploy sub-path. */
const STATUS_LABEL: Record<GameStatus, string> = {
  soon: '即将上线',
  dev: '开发中',
  live: '可玩',
  preview: '预览体验',
}

/* Render the status badge. `soon` / `dev` / `live` use the shared Chip
   primitive in @amiclaw/ui. `preview` uses a local pill (yj-yin tinted) to
   avoid extending the shared Chip variant union — `preview` is a homepage-
   only state and intentionally stays scoped to this component. */
function StatusBadge({ status }: { status: GameStatus }) {
  if (status === 'preview') {
    return <span className={styles.previewChip}>{STATUS_LABEL.preview}</span>
  }
  return <Chip variant={status}>{STATUS_LABEL[status]}</Chip>
}

/* Inner tile body — shared by both the anchor-wrapped and plain forms so
   the markup stays in sync. */
function TileBody({ game }: { game: UpcomingGame }) {
  const isLab = game.artVariant === 'lab'
  /* echo / draw / yijing show the game's Chinese name; Game Lab shows a
     bespoke Latin-flavored label, matching the atlas.html prototype.
     The .cn modifier swaps in Noto Sans SC. */
  const artLabel = isLab ? 'Lab · 提案中' : game.name
  const artLabelClass = isLab ? styles.artLabel : `${styles.artLabel} ${styles.artLabelCn}`
  return (
    <>
      <div className={`${styles.art} ${styles[game.artVariant]}`}>
        <div className={artLabelClass}>{artLabel}</div>
      </div>
      <h5 className={styles.name}>
        <span>{game.name}</span>
        <StatusBadge status={game.status} />
      </h5>
      <p className={styles.blurb}>{game.blurb}</p>
    </>
  )
}

/* Upcoming-games section — handoff §6.6. A grid of game tiles; each art
   panel is a CSS radial-gradient placeholder keyed by the game's
   `artVariant`. Platform chrome — no cyan.

   Round 5 (Yijing Oracle wiring): tiles with `href` + `status === 'preview'`
   render as `<a>` so users can click into the sibling-deployed prototype.
   Other tiles stay non-clickable. */
export default function UpcomingGames() {
  return (
    <section className={styles.section}>
      <SectionHeader eyebrow="即将上线 · IN ORBIT" title="下一批游戏。" />
      <div className={styles.grid}>
        {upcomingGames.map((game) => {
          const isPreviewLink = game.status === 'preview' && Boolean(game.href)
          if (isPreviewLink) {
            return (
              <a key={game.id} href={game.href} className={`${styles.tile} ${styles.tilePreview}`}>
                <TileBody game={game} />
              </a>
            )
          }
          return (
            <article key={game.id} className={styles.tile}>
              <TileBody game={game} />
            </article>
          )
        })}
      </div>
    </section>
  )
}
