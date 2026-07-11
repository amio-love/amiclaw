/**
 * Framework-free game store (precedent: creation/dev/store.ts).
 *
 * Owns everything the engine does NOT: presentation scarcity, per-lane slot
 * exclusivity, side assignment, the partner loop, chat, and toasts. All
 * placement lives in the engine — lanes, remaining counts, score, and bloom are
 * DERIVED from `session.getState()` each emit, so the UI can never desync from
 * engine truth (this is the mitigation for risk #4 / F2). React binds through
 * `subscribe` + `getSnapshot` (useSyncExternalStore), so the store stays
 * testable in plain Node.
 */

import { GameSession } from '@amiclaw/creation'
import { PLACEMENT_STATE } from '@amiclaw/creation'
import {
  MELODY_TYPES,
  PIECE_META,
  RELATION_FEEDBACK,
  RELATION_SCORES,
  RHYTHM_TYPES,
} from './constants'
import type { MelodyType, PieceType, RhythmType } from './constants'
import { buildLevel, elementId } from './build-level'
import { SOUND_GARDEN_GAME_TYPE } from './gametype'
import type {
  Archetype,
  BoardSnapshot,
  ChatLine,
  LevelConfig,
  PartnerAction,
  PartnerTrigger,
  Pool,
  RelationName,
  Role,
  Side,
} from './types'
import { PartnerBrain, ScriptedPartnerBrain } from '../partner/brain'
import { filterLegalActions } from '../partner/legality'
import { TriggerBus, TriggerBusConfig } from '../partner/trigger-bus'
import { NullVoice, VoiceIO } from '../voice/voice-io'

const BLOOM_LINE = '🌸 花园绽放了！我们一起种出了一首歌。'

export interface ToastEvent {
  seq: number
  text: string
  tone: RelationName | 'info'
}

/** Immutable snapshot consumed by React (stable ref between emits). */
export interface SoundGardenState {
  levelId: string
  levelIndex: number
  levelName: string
  levelSubtitle: string
  slots: number
  target: number
  score: number
  bloomed: boolean
  /**
   * First-bloom settlement latch (PR-2 §4). Latches `true` on the FIRST `isWon()`
   * transition and stays latched for the run — a later score dip / piece removal
   * never un-settles it. Play continues after the latch (the garden stays
   * interactive); only a full remount (replay / next level / side-swap) resets it.
   */
  settled: boolean
  playerSide: Side
  playerArchetype: Archetype
  partnerArchetype: Archetype
  /** melody piece per slot (0-based), engine-derived. */
  melody: (MelodyType | null)[]
  rhythm: (RhythmType | null)[]
  /** per-slot relation once both lanes fill (display echo — never the full matrix). */
  relations: (RelationName | null)[]
  /** The player-controlled lane's types in display order, with remaining counts. */
  palette: { type: PieceType; remaining: number }[]
  chat: ChatLine[]
  toast: ToastEvent | null
}

export interface GameStoreDeps {
  brain?: PartnerBrain
  voice?: VoiceIO
  busConfig?: TriggerBusConfig
  /**
   * Partner driver (PR-2). `'scripted'` (default, anon tier): the internal
   * ScriptedPartnerBrain + local voice + trigger bus drive the partner, including
   * the pre-seeded opening move on `session_start`. `'platform'` (mode②): the
   * partner is the platform co_build voice session — NO internal brain / bus turns
   * fire; the session applies moves via {@link GameStore.applyPartnerActions} and
   * pulls the board via {@link GameStore.voiceGameState}.
   */
  partnerMode?: 'scripted' | 'platform'
}

export class GameStore {
  private readonly cfg: LevelConfig
  private readonly session: GameSession
  private readonly brain: PartnerBrain
  private readonly voice: VoiceIO
  private readonly bus: TriggerBus

  private readonly side: Side
  private readonly playerArchetype: Archetype
  private readonly partnerArchetype: Archetype
  private readonly playerRole: Role
  private readonly partnerRole: Role
  private readonly playerPrefix: 'r' | 'm'
  private readonly partnerPrefix: 'r' | 'm'
  private readonly playerPool: Pool
  private readonly partnerPool: Pool
  /** mode② (platform partner) vs anon scripted partner — see {@link GameStoreDeps.partnerMode}. */
  private readonly platform: boolean

  /** First-bloom settlement latch (never un-set within a run). */
  private settled = false
  /**
   * Session-version guard (r13 medium): set on dispose (level switch / replay /
   * side-swap remounts a fresh store). A late partner reply from the old session
   * — an `applyPartnerActions` landing after the switch — is dropped, so it can
   * never mutate the retired run's engine.
   */
  private disposed = false

  private listeners = new Set<() => void>()
  private chatLines: ChatLine[] = []
  private chatSeq = 0
  private toast: ToastEvent | null = null
  private toastSeq = 0
  private cached: SoundGardenState
  /** Player utterance captured by push-to-talk, consumed by the next turn. */
  private pendingUtterance: string | null = null
  /** Resolves when the current partner turn settles (test hook). */
  private lastTurn: Promise<void> = Promise.resolve()

  constructor(cfg: LevelConfig, side: Side = 'melody', deps: GameStoreDeps = {}) {
    this.cfg = cfg
    this.side = side
    this.session = new GameSession(SOUND_GARDEN_GAME_TYPE, buildLevel(cfg))

    if (side === 'melody') {
      this.playerArchetype = 'melody_piece'
      this.partnerArchetype = 'rhythm_piece'
      this.playerRole = 'melody_builder'
      this.partnerRole = 'rhythm_builder'
      this.playerPrefix = 'm'
      this.partnerPrefix = 'r'
      this.playerPool = cfg.melodyPool
      this.partnerPool = cfg.rhythmPool
    } else {
      this.playerArchetype = 'rhythm_piece'
      this.partnerArchetype = 'melody_piece'
      this.playerRole = 'rhythm_builder'
      this.partnerRole = 'melody_builder'
      this.playerPrefix = 'r'
      this.partnerPrefix = 'm'
      this.playerPool = cfg.rhythmPool
      this.partnerPool = cfg.melodyPool
    }

    this.platform = deps.partnerMode === 'platform'
    this.brain = deps.brain ?? new ScriptedPartnerBrain(cfg.matrix, this.partnerArchetype)
    this.voice = deps.voice ?? new NullVoice()
    this.bus = new TriggerBus((t) => this.runPartnerTurn(t), deps.busConfig)

    this.cached = this.build()
    // Anon tier only: the scripted partner runs on the trigger bus. The opening
    // greeting goes through the bus too, so it shares the serial guard with
    // player-driven turns (no session_start bypass, r7 fix); the bus fires
    // session_start immediately and sets `lastTurn` synchronously so whenIdle()
    // resolves it. mode② drives the partner from the platform session instead, so
    // the bus never starts and no scripted turn fires.
    if (!this.platform) {
      this.bus.start()
      this.bus.notify('session_start')
    }
  }

  // ---- React binding (useSyncExternalStore) --------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): SoundGardenState => this.cached

  // ---- Player actions ------------------------------------------------------

  /** Plant (or replace) the player's piece at a 1-based slot. */
  plantPlayer(type: PieceType, slot: number): void {
    if (slot < 1 || slot > this.cfg.slots) return
    if (!(type in this.playerPool)) return
    const current = this.placedTypeAt(this.playerPrefix, slot)
    if (current !== type && this.remainingFor(this.playerPool, this.playerPrefix)[type]! <= 0) {
      this.setToast(`手里没有更多的${this.label(type)}了`, 'info')
      this.emit()
      return
    }
    if (current !== null && current !== type) {
      this.session.performAction(this.playerRole, 'remove_piece', {
        element_id: elementId(this.playerPrefix, current, slot),
      })
    }
    if (current !== type) {
      this.session.performAction(this.playerRole, 'place_piece', {
        element_id: elementId(this.playerPrefix, type, slot),
      })
    }
    this.emitPlacementToast(slot)
    this.emit()
    this.notifyBus('player_planted')
  }

  // ---- Push-to-talk (Round B) ----------------------------------------------

  /** Whether push-to-talk ASR is available (drives mic-chip visibility). */
  get micAvailable(): boolean {
    return this.voice.canListen
  }

  /** Capture one player utterance via the voice driver (UI awaits this). */
  captureUtterance(): Promise<string> {
    return this.voice.listen()
  }

  /** Force-stop an in-flight capture (mic-chip second tap). */
  stopListening(): void {
    this.voice.stopListening()
  }

  /** Hand a captured utterance to the partner (fires a `player_spoke` turn). */
  submitUtterance(text: string): void {
    const trimmed = text.trim()
    if (!trimmed) return
    this.pendingUtterance = trimmed
    this.pushChat(trimmed, 'player')
    this.emit()
    this.notifyBus('player_spoke')
  }

  private takePendingUtterance(): string {
    const utterance = this.pendingUtterance ?? ''
    this.pendingUtterance = null
    return utterance
  }

  /** Remove the player's piece at a 1-based slot. */
  removePlayer(slot: number): void {
    const current = this.placedTypeAt(this.playerPrefix, slot)
    if (current === null) return
    this.session.performAction(this.playerRole, 'remove_piece', {
      element_id: elementId(this.playerPrefix, current, slot),
    })
    this.setToast(`移走了${this.label(current)}`, 'info')
    this.emit()
    this.notifyBus('player_planted')
  }

  // ---- Partner loop --------------------------------------------------------

  /** One partner turn. Public so tests can drive it without the bus timers. */
  runPartnerTurn(trigger: PartnerTrigger): Promise<void> {
    const run = this.doPartnerTurn(trigger)
    this.lastTurn = run
    return run
  }

  /** Fire a board-change trigger to the scripted partner (anon only; no-op in mode②). */
  private notifyBus(trigger: PartnerTrigger): void {
    if (!this.platform) this.bus.notify(trigger)
  }

  /**
   * Apply the platform partner's co_build moves (mode②). The moves arrive already
   * shape-/vocabulary-validated by the server parse-guard; they still pass through
   * the SAME client legality guard the scripted partner uses (lane / range /
   * material against the live board) before reaching the engine. Illegal moves are
   * dropped (logged); the partner's speech is handled by the platform voice panel.
   */
  applyPartnerActions(actions: PartnerAction[]): void {
    // Session-version guard: a reply that lands after the run was torn down (level
    // switch / replay) is dropped — it belongs to a retired session.
    if (this.disposed || actions.length === 0) return
    const { legal, dropped } = filterLegalActions(actions, {
      partnerArchetype: this.partnerArchetype,
      slots: this.cfg.slots,
      partnerSlots: this.laneArray(this.partnerPrefix),
      partnerRemaining: this.remainingFor(this.partnerPool, this.partnerPrefix),
    })
    if (dropped.length > 0) {
      console.warn('[sound-garden] dropped illegal partner actions', dropped)
    }
    for (const action of legal) this.applyPartnerAction(action)
    this.emit()
  }

  /**
   * The platform voice session's `getGameState` source (mode②): the manual
   * sections the partner needs (static: matrix + rules) plus the live board as the
   * bounded `publicContext` (validated server-side by
   * `validateSoundGardenVoiceContext`). Pulled by the hook on each speech-start.
   */
  voiceGameState(): { relevantSections: string[]; publicContext: BoardSnapshot } {
    return {
      relevantSections: ['matrix', 'rules'],
      publicContext: this.boardSnapshot('player_planted'),
    }
  }

  private async doPartnerTurn(trigger: PartnerTrigger): Promise<void> {
    const wasBloomed = this.session.isWon()
    const utterance = this.takePendingUtterance()
    let speech = ''
    let actions: PartnerAction[] = []
    try {
      const reaction = await this.brain.react(this.boardSnapshot(trigger), utterance)
      speech = reaction.speech
      actions = reaction.actions
    } catch (err) {
      console.warn('[sound-garden] partner brain failed', err)
    }

    const { legal, dropped } = filterLegalActions(actions, {
      partnerArchetype: this.partnerArchetype,
      slots: this.cfg.slots,
      partnerSlots: this.laneArray(this.partnerPrefix),
      partnerRemaining: this.remainingFor(this.partnerPool, this.partnerPrefix),
    })
    if (dropped.length > 0) {
      console.warn('[sound-garden] dropped illegal partner actions', dropped)
    }
    for (const action of legal) this.applyPartnerAction(action)

    if (speech) this.pushChat(speech)
    if (!wasBloomed && this.session.isWon()) this.pushChat(BLOOM_LINE)
    this.emit()

    if (speech) {
      // Fire-and-forget: the partner's SPEECH is a cosmetic side effect and must
      // NOT gate the serial trigger bus. Awaiting it here let a hung / never-
      // resolving `speechSynthesis.speak` (no user gesture, a throttled tab, no
      // loaded voice) keep the turn `busy` forever — so every later
      // `player_planted` was held pending and the partner silently stopped
      // responding. Speaking in the background (each `speak()` cancels the prior)
      // keeps the partner loop live regardless of TTS state; the turn settles as
      // soon as the board + chat are applied.
      void this.voice.speak(speech).catch((err) => {
        console.warn('[sound-garden] voice.speak failed', err)
      })
    }
  }

  /** Apply one guard-approved partner action, enforcing lane exclusivity. */
  private applyPartnerAction(action: PartnerAction): void {
    const el = elementId(this.partnerPrefix, action.pieceType, action.slot)
    if (action.op === 'remove') {
      this.session.performAction(this.partnerRole, 'remove_piece', { element_id: el })
      return
    }
    const current = this.placedTypeAt(this.partnerPrefix, action.slot)
    if (current !== null && current !== action.pieceType) {
      this.session.performAction(this.partnerRole, 'remove_piece', {
        element_id: elementId(this.partnerPrefix, current, action.slot),
      })
    }
    if (current !== action.pieceType) {
      this.session.performAction(this.partnerRole, 'place_piece', { element_id: el })
    }
  }

  // ---- Lifecycle -----------------------------------------------------------

  dispose(): void {
    this.disposed = true
    this.bus.dispose()
    this.voice.dispose()
  }

  /** Test hook: resolves when the last partner turn settles. */
  whenIdle(): Promise<void> {
    return this.lastTurn
  }

  // ---- Derivation (engine is the single source of truth) -------------------

  private laneArray(prefix: 'r' | 'm'): (PieceType | null)[] {
    const types = prefix === 'r' ? RHYTHM_TYPES : MELODY_TYPES
    const state = this.session.getState().elements
    const arr: (PieceType | null)[] = new Array(this.cfg.slots).fill(null)
    for (let slot = 1; slot <= this.cfg.slots; slot++) {
      for (const t of types) {
        if (state[elementId(prefix, t, slot)]?.[PLACEMENT_STATE] === 'placed') {
          arr[slot - 1] = t
          break
        }
      }
    }
    return arr
  }

  private placedTypeAt(prefix: 'r' | 'm', slot: number): PieceType | null {
    return this.laneArray(prefix)[slot - 1]
  }

  private remainingFor(pool: Pool, prefix: 'r' | 'm'): Record<PieceType, number> {
    const lane = this.laneArray(prefix)
    const out = {} as Record<PieceType, number>
    for (const [type, count] of Object.entries(pool)) {
      const placed = lane.filter((x) => x === type).length
      out[type as PieceType] = (count ?? 0) - placed
    }
    return out
  }

  private boardSnapshot(trigger: PartnerTrigger): BoardSnapshot {
    return {
      slots: this.cfg.slots,
      melody: this.laneArray('m') as (MelodyType | null)[],
      rhythm: this.laneArray('r') as (RhythmType | null)[],
      score: this.session.score() ?? 0,
      target: this.cfg.target,
      bloomed: this.session.isWon(),
      partnerRemaining: this.remainingFor(this.partnerPool, this.partnerPrefix),
      playerRemaining: this.remainingFor(this.playerPool, this.playerPrefix),
      partnerArchetype: this.partnerArchetype,
      trigger,
    }
  }

  // ---- Presentation helpers ------------------------------------------------

  private label(type: PieceType): string {
    return PIECE_META[type].label
  }

  private emitPlacementToast(slot: number): void {
    const melody = this.laneArray('m')[slot - 1] as MelodyType | null
    const rhythm = this.laneArray('r')[slot - 1] as RhythmType | null
    if (melody && rhythm) {
      const relation = this.cfg.matrix[rhythm][melody]
      const score = RELATION_SCORES[relation]
      const text = `第${slot}拍 · ${RELATION_FEEDBACK[relation].text} ${score >= 0 ? '+' : ''}${score}`
      this.setToast(text, relation)
    } else {
      this.setToast('独自生长——配上另一侧才会共鸣', 'info')
    }
  }

  private setToast(text: string, tone: RelationName | 'info'): void {
    this.toastSeq += 1
    this.toast = { seq: this.toastSeq, text, tone }
  }

  private pushChat(text: string, speaker: 'partner' | 'player' = 'partner'): void {
    this.chatSeq += 1
    this.chatLines = [...this.chatLines, { seq: this.chatSeq, text, speaker }].slice(-6)
  }

  private build(): SoundGardenState {
    const bloomed = this.session.isWon()
    // First-bloom settlement latch: once won, `settled` stays true for the run's
    // lifetime — a later score dip never un-settles it (only a remount resets it).
    if (bloomed) this.settled = true
    const melody = this.laneArray('m') as (MelodyType | null)[]
    const rhythm = this.laneArray('r') as (RhythmType | null)[]
    const relations = melody.map((m, i) => {
      const r = rhythm[i]
      return m && r ? this.cfg.matrix[r][m] : null
    })
    const remaining = this.remainingFor(this.playerPool, this.playerPrefix)
    const paletteTypes = this.playerPrefix === 'm' ? MELODY_TYPES : RHYTHM_TYPES
    const palette = paletteTypes
      .filter((t) => t in this.playerPool)
      .map((t) => ({ type: t as PieceType, remaining: remaining[t] ?? 0 }))
    return {
      levelId: this.cfg.id,
      levelIndex: this.cfg.index,
      levelName: this.cfg.name,
      levelSubtitle: this.cfg.subtitle,
      slots: this.cfg.slots,
      target: this.cfg.target,
      score: this.session.score() ?? 0,
      bloomed,
      settled: this.settled,
      playerSide: this.side,
      playerArchetype: this.playerArchetype,
      partnerArchetype: this.partnerArchetype,
      melody,
      rhythm,
      relations,
      palette,
      chat: this.chatLines,
      toast: this.toast,
    }
  }

  private emit(): void {
    this.cached = this.build()
    for (const listener of this.listeners) listener()
  }
}
