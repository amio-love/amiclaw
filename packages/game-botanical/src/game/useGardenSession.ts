/**
 * React bridge over the engine GameSession (gardener-view only, Round 4).
 *
 * The engine is a persistent mutable object kept in a ref. Every mutation — a
 * care action, a decay tick, or a reset — happens inside a callback, then
 * re-derives an IMMUTABLE snapshot (plants / zones / decay rings / status /
 * clock) and stores it in state. Render reads only that snapshot, never the
 * ref, so the component stays a pure function of state. Wall-clock lives
 * entirely in useDecayLoop, which calls `advance(dt)`; this hook injects no
 * time of its own.
 *
 * Win/lose precedence is the engine's: getState().won already folds in
 * "lose wins ties" (a dead plant never shows a win).
 */
import { useCallback, useRef, useState } from 'react'
import { GameSession } from '@amiclaw/creation'
import type { GameType, Level } from '@amiclaw/creation'
import { GROWTH_LABEL, HEALTH_LABEL, LIGHT_LABEL, plantStateOrder, rankDelta } from './visual-map'

const DECAY_EMITTER_ID = 'decay'

// Runtime type is the engine's GameSession; aliased for readable signatures.
type GameSession_ = InstanceType<typeof GameSession>

export type RunStatus = 'playing' | 'won' | 'lost'

export interface PlantView {
  id: string
  potPosition: number
  species: string
  health: string
  growthStage: string
  effectiveLight: string
  /** 0 → just ticked, 1 → decay tick is due. Drives the DecayRing fill. */
  decayFraction: number
  /** True inside the emitter's warning window (amber ring). */
  decayWarning: boolean
}

export interface ZoneView {
  id: string
  zoneId: string
  lightLevel: string
  temperature: string
  positions: number[]
}

export interface CareOutcome {
  ok: boolean
  tone: 'good' | 'bad' | 'neutral'
  message: string
}

interface GardenSnapshot {
  plants: PlantView[]
  zones: ZoneView[]
  status: RunStatus
  elapsedMs: number
  ops: number
}

export interface GardenSession extends GardenSnapshot {
  /** Perform one care verb on a plant; returns player-facing feedback. */
  performCare: (elementId: string, actionType: string) => CareOutcome
  /** Advance simulated time (called by the decay loop). No-op once ended. */
  advance: (dtMs: number) => void
  /** Full reset — a fresh session, zeroed clock + op count. */
  reset: () => void
}

interface PlantSnapshot {
  health: string
  growthStage: string
  effectiveLight: string
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n
}

/** Resolved decay interval for one plant (base emitter, per-instance override). */
function decayIntervalFor(gameType: GameType, level: Level, elementId: string): number {
  const emitter = gameType.timed_emitters?.find((e) => e.id === DECAY_EMITTER_ID)
  if (!emitter) return 0
  const override = level.elements.find((e) => e.id === elementId)?.initial_timers?.[emitter.id]
  return typeof override?.interval_ms === 'number' ? override.interval_ms : emitter.interval_ms
}

function plantSnapshot(session: GameSession_, elementId: string): PlantSnapshot {
  const el = session.getState().elements[elementId] ?? {}
  return {
    health: String(el.health ?? ''),
    growthStage: String(el.growth_stage ?? ''),
    effectiveLight: String(el.effective_light ?? ''),
  }
}

function careOutcome(
  gameType: GameType,
  ok: boolean,
  before: PlantSnapshot,
  after: PlantSnapshot
): CareOutcome {
  if (!ok) return { ok: false, tone: 'neutral', message: '无法执行该养护' }
  const dHealth = rankDelta(plantStateOrder(gameType, 'health'), before.health, after.health)
  const dGrowth = rankDelta(
    plantStateOrder(gameType, 'growth_stage'),
    before.growthStage,
    after.growthStage
  )
  const lightChanged = before.effectiveLight !== after.effectiveLight
  if (dGrowth > 0 && dHealth > 0)
    return { ok: true, tone: 'good', message: `好转并生长 → ${GROWTH_LABEL[after.growthStage]}` }
  if (dGrowth > 0)
    return { ok: true, tone: 'good', message: `生长推进 → ${GROWTH_LABEL[after.growthStage]}` }
  if (dHealth > 0)
    return { ok: true, tone: 'good', message: `植株好转 → ${HEALTH_LABEL[after.health]}` }
  if (dHealth < 0)
    return { ok: true, tone: 'bad', message: `养护不当，受损 → ${HEALTH_LABEL[after.health]}` }
  if (lightChanged)
    return {
      ok: true,
      tone: 'neutral',
      message: `已调整光照 → ${LIGHT_LABEL[after.effectiveLight]}`,
    }
  return { ok: true, tone: 'neutral', message: '本次养护没有变化' }
}

/** Re-derive the immutable render snapshot from the (just-mutated) session. */
function deriveSnapshot(
  session: GameSession_,
  gameType: GameType,
  level: Level,
  elapsedMs: number,
  ops: number
): GardenSnapshot {
  const state = session.getState()
  const status: RunStatus = state.lost ? 'lost' : state.won ? 'won' : 'playing'

  const view = session.getRoleView('gardener')
  const timerByElement = new Map(
    session
      .timerStatus()
      .filter((t) => t.emitterId === DECAY_EMITTER_ID)
      .map((t) => [t.elementId, t])
  )

  const plants: PlantView[] = view.elements
    .filter((el) => el.archetype === 'plant')
    .map((el) => {
      const interval = decayIntervalFor(gameType, level, el.element_id)
      const timer = timerByElement.get(el.element_id)
      const msUntilTick = timer?.msUntilTick ?? interval
      return {
        id: el.element_id,
        potPosition: Number(el.visible_params.pot_position ?? 0),
        species: String(el.visible_params.species ?? ''),
        health: String(el.visible_states.health ?? ''),
        growthStage: String(el.visible_states.growth_stage ?? ''),
        effectiveLight: String(el.visible_states.effective_light ?? ''),
        decayFraction: interval > 0 ? clamp01(1 - msUntilTick / interval) : 0,
        decayWarning: timer?.warning ?? false,
      }
    })
    .sort((a, b) => a.potPosition - b.potPosition)

  const zones: ZoneView[] = view.elements
    .filter((el) => el.archetype === 'environment_zone')
    .map((el) => ({
      id: el.element_id,
      zoneId: String(el.visible_params.zone_id ?? ''),
      lightLevel: String(el.visible_params.light_level ?? ''),
      temperature: String(el.visible_params.temperature ?? ''),
      positions: ((el.visible_params.covers_positions as string[]) ?? [])
        .map(Number)
        .sort((a, b) => a - b),
    }))

  return { plants, zones, status, elapsedMs, ops }
}

export function useGardenSession(gameType: GameType, level: Level): GardenSession {
  const sessionRef = useRef<GameSession_ | null>(null)
  if (sessionRef.current === null) sessionRef.current = new GameSession(gameType, level)
  const elapsedRef = useRef(0)
  const opsRef = useRef(0)

  // The initial snapshot is a pure function of (gameType, level), so it is
  // derived from a throwaway fresh session — reading the persistent ref during
  // render is disallowed, and both sessions start byte-identical.
  const [snapshot, setSnapshot] = useState<GardenSnapshot>(() =>
    deriveSnapshot(new GameSession(gameType, level), gameType, level, 0, 0)
  )

  const performCare = useCallback(
    (elementId: string, actionType: string): CareOutcome => {
      const session = sessionRef.current!
      const state = session.getState()
      if (state.won || state.lost) return { ok: false, tone: 'neutral', message: '本局已结束' }
      const before = plantSnapshot(session, elementId)
      const result = session.performAction('gardener', 'apply_care', {
        element_id: elementId,
        action_type: actionType,
      })
      opsRef.current += 1
      const after = plantSnapshot(session, elementId)
      setSnapshot(deriveSnapshot(session, gameType, level, elapsedRef.current, opsRef.current))
      return careOutcome(gameType, result.ok, before, after)
    },
    [gameType, level]
  )

  const advance = useCallback(
    (dtMs: number) => {
      const session = sessionRef.current!
      const state = session.getState()
      if (state.won || state.lost) return
      elapsedRef.current += dtMs
      session.advanceTime(dtMs)
      setSnapshot(deriveSnapshot(session, gameType, level, elapsedRef.current, opsRef.current))
    },
    [gameType, level]
  )

  const reset = useCallback(() => {
    const session = new GameSession(gameType, level)
    sessionRef.current = session
    elapsedRef.current = 0
    opsRef.current = 0
    setSnapshot(deriveSnapshot(session, gameType, level, 0, 0))
  }, [gameType, level])

  return { ...snapshot, performCare, advance, reset }
}
