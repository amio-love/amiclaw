import type {
  CompanionIntent,
  Coordinate,
  Difficulty,
  ModelProposal,
  SimulationState,
} from '../engine/types'

export const MAX_REQUEST_BYTES = 16_384
export const MAX_MODEL_OUTPUT_BYTES = 2_048
export const MAX_BARK_CODEPOINTS = 48
export const MAX_STABLE_ID_CHARS = 32
export const INTENT_TIMEOUT_MS = 1_200
export const LEASE_MIN_TICKS = 4
export const LEASE_DEFAULT_TICKS = 8
export const LEASE_MAX_TICKS = 12
export const RATE_LIMIT_REQUESTS = 12
export const RATE_LIMIT_WINDOW_SECONDS = 60

export interface IntentRequest {
  version: 1
  requestId: string
  runId: string
  decisionEpoch: number
  observedTick: number
  difficulty: Difficulty
  command: CompanionIntent
  actors: Array<{ id: 'player' | 'companion'; position: Coordinate; status: 'free' | 'captured' }>
  pursuer: Coordinate
  objectives: Array<{ id: string; position: Coordinate; collected: boolean }>
  exit: Coordinate
  cooldowns: { swapReadyTick: number }
  allowedIntents: CompanionIntent[]
}

export interface IntentResponse {
  version: 1
  requestId: string
  runId: string
  decisionEpoch: number
  proposal: ModelProposal
  leaseTicks: number
}

export type IntentParseResult =
  | { ok: true; value: IntentResponse }
  | { ok: false; reason: 'size' | 'json' | 'schema' | 'bark' }

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort()
  return (
    actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index])
  )
}

function sanitizeBark(value: string): string {
  return [...value]
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint > 31 && (codePoint < 127 || codePoint > 159)
    })
    .join('')
}

export function parseIntentResponse(text: string): IntentParseResult {
  if (new TextEncoder().encode(text).byteLength > MAX_MODEL_OUTPUT_BYTES) {
    return { ok: false, reason: 'size' }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'json' }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'schema' }
  }
  const value = parsed as Record<string, unknown>
  if (
    !exactKeys(value, ['version', 'requestId', 'runId', 'decisionEpoch', 'proposal', 'leaseTicks'])
  ) {
    return { ok: false, reason: 'schema' }
  }
  if (
    value.version !== 1 ||
    typeof value.requestId !== 'string' ||
    typeof value.runId !== 'string' ||
    !Number.isSafeInteger(value.decisionEpoch) ||
    !Number.isSafeInteger(value.leaseTicks) ||
    Number(value.leaseTicks) < LEASE_MIN_TICKS ||
    Number(value.leaseTicks) > LEASE_MAX_TICKS ||
    !value.proposal ||
    typeof value.proposal !== 'object' ||
    Array.isArray(value.proposal)
  ) {
    return { ok: false, reason: 'schema' }
  }
  const proposal = value.proposal as Record<string, unknown>
  const intent = proposal.intent
  if (!['follow', 'split', 'decoy'].includes(String(intent))) {
    return { ok: false, reason: 'schema' }
  }
  const allowedKeys =
    intent === 'split' ? ['intent', 'targetObjectiveId', 'bark'] : ['intent', 'bark']
  if (Object.keys(proposal).some((key) => !allowedKeys.includes(key))) {
    return { ok: false, reason: 'schema' }
  }
  if (intent === 'split' && typeof proposal.targetObjectiveId !== 'string') {
    return { ok: false, reason: 'schema' }
  }
  if ((intent === 'follow' || intent === 'decoy') && proposal.targetObjectiveId !== undefined) {
    return { ok: false, reason: 'schema' }
  }
  let bark: string | undefined
  if (proposal.bark !== undefined) {
    if (typeof proposal.bark !== 'string') return { ok: false, reason: 'bark' }
    bark = sanitizeBark(proposal.bark)
    if ([...bark].length > MAX_BARK_CODEPOINTS) return { ok: false, reason: 'bark' }
  }
  return {
    ok: true,
    value: {
      version: 1,
      requestId: value.requestId,
      runId: value.runId,
      decisionEpoch: Number(value.decisionEpoch),
      proposal: {
        intent: intent as CompanionIntent,
        ...(typeof proposal.targetObjectiveId === 'string'
          ? { targetObjectiveId: proposal.targetObjectiveId }
          : {}),
        ...(bark ? { bark } : {}),
      },
      leaseTicks: Number(value.leaseTicks),
    },
  }
}

let requestSequence = 1

function requestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  const suffix = String(requestSequence++).padStart(12, '0')
  return `00000000-0000-4000-8000-${suffix}`
}

export function buildIntentRequest(state: SimulationState): IntentRequest {
  return {
    version: 1,
    requestId: requestId(),
    runId: state.runId,
    decisionEpoch: state.decisionEpoch,
    observedTick: state.tick,
    difficulty: state.difficulty,
    command: state.command.intent,
    actors: (['player', 'companion'] as const).map((id) => ({
      id,
      position: { ...state.actors[id].position },
      status: state.actors[id].status,
    })),
    pursuer: { ...state.actors.pursuer.position },
    objectives: state.objectives.map((objective) => ({
      id: objective.id,
      position: { ...objective.position },
      collected: objective.collected,
    })),
    exit: { ...state.exit.position },
    cooldowns: { ...state.cooldowns },
    allowedIntents: ['follow', 'split', 'decoy'],
  }
}
