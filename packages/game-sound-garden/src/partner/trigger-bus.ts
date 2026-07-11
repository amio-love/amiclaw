/**
 * Partner reaction trigger bus (L2 arch note B3).
 *
 * Under free-flow play the partner reacts on three triggers, all funneled
 * through one serial guard so at most one partner turn is ever in flight:
 *   1. player action — debounced (~600ms) so a flurry of clicks yields ONE
 *      reaction;
 *   2. player speech utterance-end (Round B; Web Speech `onend`);
 *   3. idle (~8s of no activity → an unprompted nudge).
 *
 * If a trigger arrives while a partner turn is running it is held and replayed
 * once the turn finishes (single-flight with one pending slot), so the last
 * player action is never dropped.
 */

import type { PartnerTrigger } from '../game/types'

type Timer = ReturnType<typeof setTimeout>
type Runner = (trigger: PartnerTrigger) => Promise<void>

export interface TriggerBusConfig {
  debounceMs?: number
  idleMs?: number
}

export class TriggerBus {
  private readonly runner: Runner
  private readonly debounceMs: number
  private readonly idleMs: number
  private busy = false
  private pending: PartnerTrigger | null = null
  private debounceTimer: Timer | null = null
  private idleTimer: Timer | null = null
  private disposed = false

  constructor(runner: Runner, config: TriggerBusConfig = {}) {
    this.runner = runner
    this.debounceMs = config.debounceMs ?? 600
    this.idleMs = config.idleMs ?? 8000
  }

  /** Begin the idle countdown (call once the session board is ready). */
  start(): void {
    this.armIdle()
  }

  notify(trigger: PartnerTrigger): void {
    if (this.disposed) return
    this.armIdle()
    if (trigger === 'session_start' || trigger === 'player_spoke') {
      void this.fire(trigger)
      return
    }
    // player_planted → debounce so rapid plants coalesce into one reaction.
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => void this.fire('player_planted'), this.debounceMs)
  }

  dispose(): void {
    this.disposed = true
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    if (this.idleTimer) clearTimeout(this.idleTimer)
  }

  private armIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    if (this.disposed) return
    this.idleTimer = setTimeout(() => void this.fire('idle'), this.idleMs)
  }

  private async fire(trigger: PartnerTrigger): Promise<void> {
    if (this.disposed) return
    if (this.busy) {
      this.pending = trigger
      return
    }
    this.busy = true
    try {
      await this.runner(trigger)
    } finally {
      this.busy = false
      if (!this.disposed) {
        this.armIdle()
        const next = this.pending
        this.pending = null
        if (next) void this.fire(next)
      }
    }
  }
}
