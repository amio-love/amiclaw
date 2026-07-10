import type { Difficulty } from '../engine/types'

interface StartScreenProps {
  difficulty: Difficulty
  mapId: string
  onDifficultyChange(value: Difficulty): void
  onMapChange(value: string): void
  onStart(): void
}

export function StartScreen(props: StartScreenProps) {
  return (
    <main className="start-shell">
      <p className="eyebrow">AMIO Arcade · One human + one AI companion</p>
      <h1>Dual Shadow Chase</h1>
      <p className="start-rule">
        Your first 5 seconds are a head start: the pursuer is frozen. Collect three light cores; the
        moon gate opens at 02:00. Rescue a captured partner, then leave together.
      </p>
      <div className="start-options" aria-label="Run options">
        <label>
          Difficulty
          <select
            value={props.difficulty}
            onChange={(event) => props.onDifficultyChange(event.target.value as Difficulty)}
          >
            <option value="relaxed">Relaxed</option>
            <option value="standard">Standard</option>
            <option value="intense">Intense</option>
          </select>
        </label>
        <label>
          Map
          <select value={props.mapId} onChange={(event) => props.onMapChange(event.target.value)}>
            <option value="courtyard">Starlit Courtyard</option>
            <option value="crossroads">Moonlit Crossroads</option>
            <option value="moon-vault">Moon Vault</option>
          </select>
        </label>
      </div>
      <button className="primary-button" type="button" onClick={props.onStart}>
        Start chase
      </button>
      <p className="control-hint">Move with WASD, arrow keys, the direction pad, or tap a tile.</p>
    </main>
  )
}
