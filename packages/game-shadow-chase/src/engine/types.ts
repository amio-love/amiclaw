export type Direction = 'up' | 'down' | 'left' | 'right'
export type Difficulty = 'relaxed' | 'standard' | 'intense'
export type CompanionIntent = 'support' | 'scout' | 'anchor'
export type SimulationPhase = 'running' | 'win' | 'loss' | 'timeout'
export type PlayerInputRejectionReason =
  | 'wall'
  | 'edge'
  | 'companion'
  | 'unreachable'
  | 'captured'
  | 'queue-full'

export interface Coordinate {
  x: number
  y: number
}

export interface ObjectiveDefinition {
  id: string
  position: Coordinate
}

export interface MapDefinition {
  id: string
  name: string
  width: number
  height: number
  walls: Coordinate[]
  playerSpawn: Coordinate
  companionSpawn: Coordinate
  pursuerSpawn: Coordinate
  exit: Coordinate
  objectives: ObjectiveDefinition[]
}

export interface ShadowActor {
  id: 'player' | 'companion'
  position: Coordinate
  status: 'free' | 'captured'
  rescueDeadlineTick?: number
}

export interface PursuerActor {
  id: 'pursuer'
  position: Coordinate
  /** The pursuer prefers the player and targets the companion only during player rescue. */
  target: 'player' | 'companion'
  /** Actual movement destination selected by the latest observation. */
  destination: 'player' | 'companion'
}

export interface ObjectiveState extends ObjectiveDefinition {
  collected: boolean
}

export interface ModelProposal {
  intent: CompanionIntent
  targetObjectiveId?: string
  bark?: string
}

export interface ModelLease extends ModelProposal {
  requestId: string
  acceptedTick: number
  expiryTick: number
}

export type EngineEventType =
  | 'move'
  | 'move-rejected'
  | 'swap'
  | 'swap-rejected'
  | 'capture'
  | 'rescue'
  | 'core-collected'
  | 'command'
  | 'model-lease'
  | 'model-rejected'
  | 'win'
  | 'loss'
  | 'timeout'

export interface EngineEvent {
  tick: number
  type: EngineEventType
  actorId?: string
  detail?: string
  actionSequence?: number
  reason?: PlayerInputRejectionReason
}

export interface PlayerNavigation {
  target: Coordinate
  actionSequence: number
}

export interface PlayerInputFeedback {
  tick: number
  actionSequence: number
  reason: PlayerInputRejectionReason
}

export interface TerminalSummary {
  outcome: 'win' | 'loss' | 'timeout'
  reason: 'joint-exit' | 'both-captured' | 'rescue-deadline' | 'run-cap'
  tick: number
}

export interface SimulationState {
  schemaVersion: 1
  seed: number
  rngState: number
  runId: string
  // Per-attempt settlement identity, minted fresh (crypto.randomUUID) each time
  // the live store creates or resets a run. Unlike `runId` — which is
  // deterministic from the seed (`runIdForSeed`) and load-bearing for
  // intent-legality, decision-boundaries, replay, and DOM ids — `attemptId` is
  // unique per play attempt, so it is the correct idempotency component for the
  // win-reward + settlement-capture keys (distinct attempts credit; a retry of
  // the same attempt dedups). Deterministic runs (replay / tests) fall back to
  // the seed-derived id via createRunningState's default.
  attemptId: string
  tick: number
  phase: SimulationPhase
  mapId: string
  difficulty: Difficulty
  actors: {
    player: ShadowActor
    companion: ShadowActor
    pursuer: PursuerActor
  }
  objectives: ObjectiveState[]
  exit: { position: Coordinate; enabled: boolean }
  command: { intent: CompanionIntent; targetObjectiveId?: string }
  playerNavigation?: PlayerNavigation
  swapCharges: number
  activeModelLease?: ModelLease
  decisionEpoch: number
  eventLog: EngineEvent[]
  terminal?: TerminalSummary
}

export type EngineAction =
  | { type: 'player-move'; direction: Direction }
  | { type: 'player-target'; target: Coordinate }
  | { type: 'player-input-rejected'; reason: 'queue-full' }
  | { type: 'companion-command'; command: CompanionIntent; targetObjectiveId?: string }
  | { type: 'swap' }
  | {
      type: 'accept-model-proposal'
      requestId: string
      runId: string
      decisionEpoch: number
      proposal: ModelProposal
      leaseTicks: number
    }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'restart' }

export interface QueuedAction {
  applyAtTick: number
  sequence: number
  action: EngineAction
}

export interface ReplayRecord {
  schemaVersion: 1
  seed: number
  mapId: string
  difficulty: Difficulty
  actions: QueuedAction[]
}
