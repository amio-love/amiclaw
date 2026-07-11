import { Button, GlassCard } from '@amiclaw/ui'

interface SoundGardenResultsProps {
  /** Whether the overlay is shown — `settled && !dismissed`. The latch stays true
   *  after dismissal, so the overlay never auto-reopens for the run. */
  open: boolean
  score: number
  target: number
  hasNext: boolean
  onReplay: () => void
  onNext: () => void
  onExit: () => void
  /** Dismiss and keep playing (backdrop tap or 继续修剪). Fires once; latch unaffected. */
  onDismiss: () => void
}

/**
 * First-bloom settlement overlay (PR-2 §4). Shows over the still-visible garden on
 * the first bloom — bloom is the settlement event (no leaderboard, no score
 * submission). It is DISMISSIBLE: the locked semantics are "settlement fires once,
 * continued play allowed", so tapping the backdrop or 继续修剪 closes it and the
 * garden is fully interactive again. The `settled` latch stays true, so the overlay
 * never auto-reopens this run; only a remount (replay / next level) resets it.
 */
export default function SoundGardenResults({
  open,
  score,
  target,
  hasNext,
  onReplay,
  onNext,
  onExit,
  onDismiss,
}: SoundGardenResultsProps) {
  if (!open) return null
  return (
    <div
      className="sg-results"
      role="dialog"
      aria-modal="false"
      aria-labelledby="sg-result-title"
      onClick={onDismiss}
    >
      {/* Stop taps on the card from bubbling to the dismiss-on-backdrop handler. */}
      <div className="sg-results-cardwrap" onClick={(e) => e.stopPropagation()}>
        <GlassCard radius="2xl" className="sg-results-card">
          <h2 id="sg-result-title" className="sg-results-title">
            🌸 花园绽放了
          </h2>
          <p className="sg-results-sub">你们一起种出了一首歌。</p>
          <div className="sg-results-score">
            <b>{score}</b>
            <span>/ {target} 和声分</span>
          </div>
          <div className="sg-results-cta">
            <Button variant="primary" onClick={onReplay}>
              再玩一次
            </Button>
            {hasNext && (
              <Button variant="ghost" onClick={onNext}>
                下一关 ›
              </Button>
            )}
            <Button variant="ghost" onClick={onExit}>
              换个花园
            </Button>
          </div>
          <button type="button" className="sg-results-continue" onClick={onDismiss}>
            继续修剪这座花园 ›
          </button>
        </GlassCard>
      </div>
    </div>
  )
}
