import type { CompanionContext } from '../../companion-memory/src/types'
import type { SessionReader } from './auth-seam'
import { resolveIntentConfig } from './provider-config'
import type { IntentRateLimiter, IntentRateLimitResult } from './shadow-chase-intent-rate-limit'
import type { LlmCompletionChunk, LlmProvider } from './providers/types'

export const MAX_REQUEST_BYTES = 16_384
export const MAX_MODEL_OUTPUT_BYTES = 2_048
export const MAX_BARK_CODEPOINTS = 48
export const MAX_STABLE_ID_CHARS = 32
export const INTENT_TIMEOUT_MS = 1_200
export const LEASE_MIN_TICKS = 4
export const LEASE_DEFAULT_TICKS = 8
export const LEASE_MAX_TICKS = 12

const RUN_CAP_TICKS = 1_200
const MAX_COORDINATE = 14
const OBJECTIVE_COUNT = 3
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STABLE_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/

export type ShadowChaseIntent = 'support' | 'scout' | 'anchor'
export type ShadowChaseDifficulty = 'relaxed' | 'standard' | 'intense'

export interface ShadowChaseCoordinate {
  x: number
  y: number
}

export interface ShadowChaseIntentActor {
  id: 'player' | 'companion'
  position: ShadowChaseCoordinate
  status: 'free' | 'captured'
}

export interface ShadowChaseIntentObjective {
  id: string
  position: ShadowChaseCoordinate
  collected: boolean
}

export interface ShadowChaseIntentRequest {
  version: 1
  requestId: string
  runId: string
  decisionEpoch: number
  observedTick: number
  difficulty: ShadowChaseDifficulty
  command: ShadowChaseIntent
  actors: ShadowChaseIntentActor[]
  pursuer: ShadowChaseCoordinate
  objectives: ShadowChaseIntentObjective[]
  exit: ShadowChaseCoordinate
  swapCharges: number
  allowedIntents: ShadowChaseIntent[]
}

export interface ShadowChaseIntentResponse {
  version: 1
  requestId: string
  runId: string
  decisionEpoch: number
  proposal: {
    intent: ShadowChaseIntent
    targetObjectiveId?: string
    bark?: string
  }
  leaseTicks: number
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; reason: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(record).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function isSafeIntegerBetween(value: unknown, min: number, max: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max
}

function isCoordinate(value: unknown): value is ShadowChaseCoordinate {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['x', 'y']) &&
    isSafeIntegerBetween(value.x, 0, MAX_COORDINATE) &&
    isSafeIntegerBetween(value.y, 0, MAX_COORDINATE)
  )
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && value.length === 36 && UUID_PATTERN.test(value)
}

function isStableId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_STABLE_ID_CHARS &&
    STABLE_ID_PATTERN.test(value)
  )
}

function isIntent(value: unknown): value is ShadowChaseIntent {
  return value === 'support' || value === 'scout' || value === 'anchor'
}

function isDifficulty(value: unknown): value is ShadowChaseDifficulty {
  return value === 'relaxed' || value === 'standard' || value === 'intense'
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint <= 31 || (codePoint >= 127 && codePoint <= 159)) return true
  }
  return false
}

function validateActor(value: unknown): value is ShadowChaseIntentActor {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['id', 'position', 'status']) &&
    (value.id === 'player' || value.id === 'companion') &&
    isCoordinate(value.position) &&
    (value.status === 'free' || value.status === 'captured')
  )
}

function validateObjective(value: unknown): value is ShadowChaseIntentObjective {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['id', 'position', 'collected']) &&
    isStableId(value.id) &&
    isCoordinate(value.position) &&
    typeof value.collected === 'boolean'
  )
}

export function validateShadowChaseIntentRequest(
  value: unknown
): ValidationResult<ShadowChaseIntentRequest> {
  if (!isRecord(value)) return { ok: false, reason: 'object' }
  if (
    !hasExactKeys(value, [
      'version',
      'requestId',
      'runId',
      'decisionEpoch',
      'observedTick',
      'difficulty',
      'command',
      'actors',
      'pursuer',
      'objectives',
      'exit',
      'swapCharges',
      'allowedIntents',
    ])
  ) {
    return { ok: false, reason: 'keys' }
  }
  if (value.version !== 1) return { ok: false, reason: 'version' }
  if (!isUuid(value.requestId) || !isUuid(value.runId)) return { ok: false, reason: 'id' }
  if (!isSafeIntegerBetween(value.decisionEpoch, 0, Number.MAX_SAFE_INTEGER)) {
    return { ok: false, reason: 'decisionEpoch' }
  }
  // The server has no authoritative simulation clock. It enforces only the
  // frozen safe range; client-side generation/epoch checks own freshness.
  if (!isSafeIntegerBetween(value.observedTick, 0, RUN_CAP_TICKS)) {
    return { ok: false, reason: 'observedTick' }
  }
  if (!isDifficulty(value.difficulty) || !isIntent(value.command)) {
    return { ok: false, reason: 'mode' }
  }
  if (
    !Array.isArray(value.actors) ||
    value.actors.length !== 2 ||
    !value.actors.every(validateActor)
  ) {
    return { ok: false, reason: 'actors' }
  }
  const actorIds = new Set(value.actors.map((actor) => actor.id))
  if (actorIds.size !== 2 || !actorIds.has('player') || !actorIds.has('companion')) {
    return { ok: false, reason: 'actors' }
  }
  if (!isCoordinate(value.pursuer)) {
    return { ok: false, reason: 'pursuer' }
  }
  if (
    !Array.isArray(value.objectives) ||
    value.objectives.length !== OBJECTIVE_COUNT ||
    !value.objectives.every(validateObjective) ||
    new Set(value.objectives.map((objective) => objective.id)).size !== OBJECTIVE_COUNT
  ) {
    return { ok: false, reason: 'objectives' }
  }
  if (!isCoordinate(value.exit)) {
    return { ok: false, reason: 'exit' }
  }
  if (!isSafeIntegerBetween(value.swapCharges, 0, OBJECTIVE_COUNT)) {
    return { ok: false, reason: 'swapCharges' }
  }
  if (
    !Array.isArray(value.allowedIntents) ||
    value.allowedIntents.length < 1 ||
    value.allowedIntents.length > 3 ||
    !value.allowedIntents.every(isIntent) ||
    new Set(value.allowedIntents).size !== value.allowedIntents.length
  ) {
    return { ok: false, reason: 'allowedIntents' }
  }
  return { ok: true, value: value as unknown as ShadowChaseIntentRequest }
}

export function parseShadowChaseIntentResponse(
  text: string,
  request: ShadowChaseIntentRequest
): ValidationResult<ShadowChaseIntentResponse> {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'json' }
  }
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'version',
      'requestId',
      'runId',
      'decisionEpoch',
      'proposal',
      'leaseTicks',
    ])
  ) {
    return { ok: false, reason: 'keys' }
  }
  if (
    value.version !== 1 ||
    value.requestId !== request.requestId ||
    value.runId !== request.runId ||
    value.decisionEpoch !== request.decisionEpoch
  ) {
    return { ok: false, reason: 'correlation' }
  }
  if (!isSafeIntegerBetween(value.leaseTicks, LEASE_MIN_TICKS, LEASE_MAX_TICKS)) {
    return { ok: false, reason: 'lease' }
  }
  if (!isRecord(value.proposal)) return { ok: false, reason: 'proposal' }
  const proposal = value.proposal
  const intent = proposal.intent
  if (!isIntent(intent) || !request.allowedIntents.includes(intent)) {
    return { ok: false, reason: 'intent' }
  }
  const targetExpected = intent === 'scout'
  const proposalKeys = Object.keys(proposal)
  const allowedKeys = targetExpected
    ? new Set(['intent', 'targetObjectiveId', 'bark'])
    : new Set(['intent', 'bark'])
  if (proposalKeys.some((key) => !allowedKeys.has(key))) {
    return { ok: false, reason: 'proposal-keys' }
  }
  if (targetExpected) {
    if (!isStableId(proposal.targetObjectiveId)) {
      return { ok: false, reason: 'target' }
    }
    const target = request.objectives.find(
      (objective) => objective.id === proposal.targetObjectiveId
    )
    // Every authored objective is statically reachable by the map invariant;
    // the compressed wire therefore needs only current presence + collection.
    if (!target || target.collected) {
      return { ok: false, reason: 'target' }
    }
  } else if ('targetObjectiveId' in proposal) {
    return { ok: false, reason: 'target' }
  }
  if ('bark' in proposal) {
    if (
      typeof proposal.bark !== 'string' ||
      containsControlCharacter(proposal.bark) ||
      [...proposal.bark].length > MAX_BARK_CODEPOINTS
    ) {
      return { ok: false, reason: 'bark' }
    }
  }
  return { ok: true, value: value as unknown as ShadowChaseIntentResponse }
}

export interface ShadowChaseIntentLog {
  event: 'shadow-chase-intent'
  requestId?: string
  decisionEpoch?: number
  outcome: string
  latencyMs: number
  requestBytes: number
  responseBytes: number
  rateLimit?: 'allowed' | 'denied' | 'error'
  parseResult?: 'accepted' | 'rejected'
  abortReason?: 'deadline' | 'client'
}

export interface ShadowChaseIntentDependencies {
  sessionReader: SessionReader
  rateLimiter: IntentRateLimiter
  resolveCompanionContext: (
    userId: string,
    gameId: 'shadow-chase'
  ) => Promise<CompanionContext | null>
  llm: LlmProvider
  nowMs?: () => number
  logger?: (entry: ShadowChaseIntentLog) => void
}

type BodyReadResult =
  | { ok: true; value: unknown; bytes: number }
  | { ok: false; status: 400 | 413; bytes: number }

async function readBoundedJson(request: Request, maxBytes: number): Promise<BodyReadResult> {
  const declared = request.headers.get('Content-Length')
  if (declared !== null) {
    const length = Number(declared)
    if (Number.isFinite(length) && length > maxBytes) {
      return { ok: false, status: 413, bytes: length }
    }
  }
  if (request.body === null) return { ok: false, status: 400, bytes: 0 }
  const reader = request.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })
  let text = ''
  let bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > maxBytes) return { ok: false, status: 413, bytes }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
  } catch {
    return { ok: false, status: 400, bytes }
  } finally {
    try {
      await reader.cancel()
    } catch {
      // The request body is already closed or errored.
    }
    reader.releaseLock()
  }
  try {
    return { ok: true, value: JSON.parse(text), bytes }
  } catch {
    return { ok: false, status: 400, bytes }
  }
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

function defaultLogger(entry: ShadowChaseIntentLog): void {
  // Structured success/failure metadata is intentionally emitted at log level.
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(entry))
}

function buildMessages(
  request: ShadowChaseIntentRequest,
  companion: CompanionContext | null
): Array<{ role: 'system' | 'user'; content: string }> {
  const config = resolveIntentConfig('shadow-chase')
  const responseContract = {
    version: 1,
    requestId: request.requestId,
    runId: request.runId,
    decisionEpoch: request.decisionEpoch,
    proposal: {
      intent: 'support | scout | anchor',
      targetObjectiveId: 'required only for scout',
      bark: `optional, at most ${MAX_BARK_CODEPOINTS} Unicode code points`,
    },
    leaseTicks: `${LEASE_MIN_TICKS}..${LEASE_MAX_TICKS}`,
  }
  return [
    {
      role: 'system',
      content: [
        config.systemPromptConfig.role,
        ...config.systemPromptConfig.ruleTemplate,
        `Response contract: ${JSON.stringify(responseContract)}`,
        `Existing companion context (may be null): ${JSON.stringify(companion)}`,
      ].join('\n'),
    },
    { role: 'user', content: JSON.stringify(request) },
  ]
}

class ModelOutputTooLargeError extends Error {}

async function collectModelOutput(
  provider: LlmProvider,
  request: ShadowChaseIntentRequest,
  companion: CompanionContext | null,
  signal: AbortSignal
): Promise<{ text: string; bytes: number }> {
  const config = resolveIntentConfig('shadow-chase')
  const iterator = provider
    .streamCompletion({
      model: config.llm.model,
      messages: buildMessages(request, companion),
      temperature: 0,
      signal,
    })
    [Symbol.asyncIterator]()
  let text = ''
  let bytes = 0
  try {
    for (;;) {
      const result = await iterator.next()
      if (result.done) break
      const chunk: LlmCompletionChunk = result.value
      if (chunk.content) {
        text += chunk.content
        bytes = new TextEncoder().encode(text).byteLength
        if (bytes > MAX_MODEL_OUTPUT_BYTES) {
          throw new ModelOutputTooLargeError('shadow-intent: model output too large')
        }
      }
      if (chunk.done) break
    }
    return { text, bytes }
  } finally {
    try {
      await iterator.return?.()
    } catch {
      // The provider is already aborted/errored. Its own generator cleanup ran.
    }
  }
}

function serviceUnavailable(): Response {
  return jsonResponse({ error: 'intent service unavailable' }, 503)
}

export async function handleShadowChaseIntent(
  request: Request,
  dependencies: Partial<ShadowChaseIntentDependencies>
): Promise<Response> {
  const startedAt = dependencies.nowMs?.() ?? Date.now()
  const logger = dependencies.logger ?? defaultLogger
  let requestBytes = 0
  const log = (entry: Omit<ShadowChaseIntentLog, 'event' | 'latencyMs' | 'requestBytes'>): void => {
    const now = dependencies.nowMs?.() ?? Date.now()
    logger({
      event: 'shadow-chase-intent',
      latencyMs: Math.max(0, now - startedAt),
      requestBytes,
      ...entry,
    })
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'method not allowed' }, 405)
  }
  const url = new URL(request.url)
  if (request.headers.get('Origin') !== url.origin) {
    return jsonResponse({ error: 'forbidden origin' }, 403)
  }
  const mediaType = request.headers.get('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (mediaType !== 'application/json') {
    return jsonResponse({ error: 'application/json required' }, 415)
  }

  const body = await readBoundedJson(request, MAX_REQUEST_BYTES)
  requestBytes = body.bytes
  if (!body.ok) {
    return jsonResponse(
      { error: body.status === 413 ? 'request too large' : 'invalid JSON' },
      body.status
    )
  }
  const validated = validateShadowChaseIntentRequest(body.value)
  if (!validated.ok) {
    return jsonResponse({ error: 'invalid intent request', reason: validated.reason }, 422)
  }
  const intentRequest = validated.value

  const { sessionReader, rateLimiter, resolveCompanionContext, llm } = dependencies
  if (!sessionReader || !rateLimiter || !resolveCompanionContext || !llm) {
    log({
      requestId: intentRequest.requestId,
      decisionEpoch: intentRequest.decisionEpoch,
      outcome: 'dependency-unavailable',
      responseBytes: 0,
    })
    return serviceUnavailable()
  }

  let identity: Awaited<ReturnType<SessionReader['resolve']>>
  try {
    identity = await sessionReader.resolve(request.headers.get('Cookie'))
  } catch {
    log({
      requestId: intentRequest.requestId,
      decisionEpoch: intentRequest.decisionEpoch,
      outcome: 'auth-unavailable',
      responseBytes: 0,
    })
    return serviceUnavailable()
  }
  if (identity === null) {
    return jsonResponse({ error: 'authentication required' }, 401)
  }

  let rateLimit: IntentRateLimitResult
  try {
    rateLimit = await rateLimiter.consume(identity.userId, dependencies.nowMs?.() ?? Date.now())
  } catch {
    log({
      requestId: intentRequest.requestId,
      decisionEpoch: intentRequest.decisionEpoch,
      outcome: 'rate-limit-unavailable',
      responseBytes: 0,
      rateLimit: 'error',
    })
    return serviceUnavailable()
  }
  if (!rateLimit.allowed) {
    log({
      requestId: intentRequest.requestId,
      decisionEpoch: intentRequest.decisionEpoch,
      outcome: 'rate-limited',
      responseBytes: 0,
      rateLimit: 'denied',
    })
    return jsonResponse({ error: 'rate limit exceeded' }, 429)
  }

  let companion: CompanionContext | null
  try {
    companion = await resolveCompanionContext(identity.userId, 'shadow-chase')
  } catch {
    log({
      requestId: intentRequest.requestId,
      decisionEpoch: intentRequest.decisionEpoch,
      outcome: 'companion-unavailable',
      responseBytes: 0,
      rateLimit: 'allowed',
    })
    return serviceUnavailable()
  }

  const controller = new AbortController()
  let abortReason: 'deadline' | 'client' | undefined
  const abortForClient = (): void => {
    abortReason = 'client'
    if (!controller.signal.aborted) {
      controller.abort(request.signal.reason ?? new Error('shadow-intent: client aborted'))
    }
  }
  if (request.signal.aborted) abortForClient()
  else request.signal.addEventListener('abort', abortForClient, { once: true })
  const deadline = setTimeout(() => {
    abortReason = 'deadline'
    controller.abort(new Error(`shadow-intent: deadline exceeded after ${INTENT_TIMEOUT_MS}ms`))
  }, INTENT_TIMEOUT_MS)

  let modelOutput: { text: string; bytes: number }
  try {
    modelOutput = await collectModelOutput(llm, intentRequest, companion, controller.signal)
  } catch (error) {
    const timedOut = abortReason === 'deadline'
    log({
      requestId: intentRequest.requestId,
      decisionEpoch: intentRequest.decisionEpoch,
      outcome:
        error instanceof ModelOutputTooLargeError
          ? 'model-output-too-large'
          : timedOut
            ? 'deadline'
            : 'provider-error',
      responseBytes: 0,
      rateLimit: 'allowed',
      ...(abortReason ? { abortReason } : {}),
    })
    return jsonResponse(
      { error: timedOut ? 'intent provider timed out' : 'intent provider failed' },
      timedOut ? 504 : 502
    )
  } finally {
    clearTimeout(deadline)
    request.signal.removeEventListener('abort', abortForClient)
  }

  const parsed = parseShadowChaseIntentResponse(modelOutput.text, intentRequest)
  if (!parsed.ok) {
    log({
      requestId: intentRequest.requestId,
      decisionEpoch: intentRequest.decisionEpoch,
      outcome: 'invalid-model-output',
      responseBytes: modelOutput.bytes,
      rateLimit: 'allowed',
      parseResult: 'rejected',
    })
    return jsonResponse({ error: 'invalid intent provider output' }, 502)
  }

  log({
    requestId: intentRequest.requestId,
    decisionEpoch: intentRequest.decisionEpoch,
    outcome: 'accepted',
    responseBytes: modelOutput.bytes,
    rateLimit: 'allowed',
    parseResult: 'accepted',
  })
  return jsonResponse(parsed.value, 200)
}
