/**
 * Transport + score. Play/stop loops the 8-step garden (~96 BPM); the harmony
 * meter fills toward the target. Time is not a deadline — bloom is the reward,
 * and the garden keeps playing after it (free-flow, no-fail).
 */

interface TransportProps {
  playing: boolean
  score: number
  target: number
  bloomed: boolean
  onTogglePlay: () => void
}

export function Transport(props: TransportProps) {
  const pct = Math.max(0, Math.min(100, (props.score / props.target) * 100))
  return (
    <section className="sg-transport">
      <button
        type="button"
        className={`sg-play ${props.playing ? 'playing' : ''}`}
        onClick={props.onTogglePlay}
      >
        {props.playing ? '⏸ 停止' : '▶ 播放'}
      </button>
      <div className="sg-scorebox">
        <div className="sg-score">
          和声 <span className="sg-scoreval">{props.score}</span> / 目标 {props.target}
        </div>
        <div className="sg-meter">
          <div
            className={`sg-meter-fill ${props.bloomed ? 'bloomed' : ''}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </section>
  )
}
