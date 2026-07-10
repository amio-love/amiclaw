import type { CompanionIntent, SimulationState } from '../engine/types'

const COMMANDS: Array<{ intent: CompanionIntent; label: string; description: string }> = [
  { intent: 'follow', label: 'Follow', description: 'Stay close and collect nearby cores.' },
  { intent: 'split', label: 'Split', description: 'Take a separate route to the next core.' },
  { intent: 'decoy', label: 'Decoy', description: 'Draw the pursuer away from the player.' },
]

export function CommandBar({
  state,
  onCommand,
  onSwap,
}: {
  state: SimulationState
  onCommand(intent: CompanionIntent): void
  onSwap(): void
}) {
  const swapTicks = Math.max(0, state.cooldowns.swapReadyTick - state.tick)
  const swapDisabled =
    swapTicks > 0 ||
    state.actors.player.status === 'captured' ||
    state.actors.companion.status === 'captured'
  return (
    <section className="command-panel" aria-label="Companion commands">
      <div className="command-row">
        {COMMANDS.map((command) => (
          <button
            key={command.intent}
            className="command-button"
            type="button"
            aria-pressed={state.command.intent === command.intent}
            title={command.description}
            onClick={() => onCommand(command.intent)}
          >
            {command.label}
          </button>
        ))}
      </div>
      <button
        className="swap-button"
        type="button"
        disabled={swapDisabled}
        aria-describedby="swap-reason"
        onClick={onSwap}
      >
        Swap positions
      </button>
      <span id="swap-reason" className="control-reason">
        {swapTicks > 0
          ? `Swap recharging: ${(swapTicks / 4).toFixed(1)}s`
          : swapDisabled
            ? 'Swap needs both shadows free.'
            : 'Swap is ready.'}
      </span>
    </section>
  )
}
