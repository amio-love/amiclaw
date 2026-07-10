export type Direction = 'up' | 'down' | 'left' | 'right'
export type Difficulty = 'relaxed' | 'standard' | 'intense'
export type CompanionIntent = 'follow' | 'split' | 'decoy'
export type SimulationPhase = 'running' | 'win' | 'loss' | 'timeout'

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
  target: 'player' | 'companion'
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
  cooldowns: { swapReadyTick: number }
  activeModelLease?: ModelLease
  decisionEpoch: number
  eventLog: EngineEvent[]
  terminal?: TerminalSummary
}

export type EngineAction =
  | { type: 'player-move'; direction: Direction }
  | { type: 'player-target'; target: Coordinate }
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
