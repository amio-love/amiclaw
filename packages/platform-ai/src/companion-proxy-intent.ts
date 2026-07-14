/**
 * Companion proxy social — the two bounded generation routes
 * (L2 arch-component-proxy-social §Mechanism V1/V2 + §Interface).
 *
 *  - V1 `POST /ai-intent/companion-proxy-message`: 甲 logged-in and present, the
 *    companion AUTONOMOUSLY leaves one public line on another player's community
 *    event. Background trigger → EVERY skip reason is a silent `200 messaged:false`
 *    (no companion / no public profile / no candidate / daily cap / model decline /
 *    concurrent-duplicate). Success carries `target_event` so the dock transparency
 *    line renders without a second feed read.
 *  - V2 `POST /ai-intent/companion-proxy-reply`: 乙 taps "let my companion reply".
 *    User-initiated → explicit status codes (401 / 403 / 404 / 409 / 410 / 429 / 502).
 *
 * Both share the `shadow-chase-intent` bounded skeleton (POST + same-origin,
 * bounded JSON body, session-reader identity, KV rate limiter, deadline + abort,
 * output byte/codepoint cap, control-char filter) and reuse the SAME privacy seam:
 * `resolveCompanionContext` (game-global, gameId omitted) → `filterPublicGeneration
 * Context` before any of it reaches a public prompt. Identity is ALWAYS the
 * server-side session user_id; request bodies carry only an opaque id, never an
 * owner id and never free text.
 *
 * The handlers are pure: every store read/write, the session reader, the limiter,
 * the LLM, and the id/clock are INJECTED, so the whole matrix (guards, caps,
 * decline, collision, window, 409 reason dispatch) is unit-testable with mocks.
 * `worker.ts` wires the real arcade-profile / companion-memory / provider deps.
 */

import type { CompanionContext } from '../../companion-memory/src/types'
import type {
  InsertProxyMessageInput,
  InsertProxyReplyInput,
  InsertProxyResult,
  ProxyCandidateEvent,
  ProxyMessageRecord,
} from '../../arcade-profile/src/store'
import type {
  ArcadeCommunityFeedItem,
  ArcadeCommunityFeedTemplate,
  ArcadePublicProfileStatus,
} from '../../arcade-profile/src/types'
import type { SessionReader } from './auth-seam'
import type { ResolvedIntentConfig } from './provider-config'
import { resolveIntentConfig } from './provider-config'
import { filterPublicGenerationContext, type PublicProxyContext } from './proxy-social-filter'
import type { IntentRateLimiter, IntentRateLimitResult } from './shadow-chase-intent-rate-limit'
import type { ChatMessage, LlmCompletionChunk, LlmProvider } from './providers/types'

/** Bounded body cap — proxy bodies are tiny (`{}` or `{message_id}`). */
export const MAX_PROXY_REQUEST_BYTES = 4_096
/** Streaming output byte cap (mirrors the shadow-chase model-output guard). */
export const MAX_PROXY_MODEL_OUTPUT_BYTES = 2_048
/** Final generated-line codepoint cap — a proxy line is one or two sentences. */
export const MAX_PROXY_BODY_CODEPOINTS = 240
/** Per-user daily proxy-authoring cap (conservative v1 initial value — spec
    Open Question; tuned once real community density is observed). */
export const DAILY_PROXY_CAP = 3
/** Generation deadline for one proxy line. Longer than the shadow-chase JSON
    intent (a warm sentence is heavier than a tiny structured proposal). */
export const PROXY_INTENT_TIMEOUT_MS = 4_000
/** Opaque message-id shape accepted on the V2 reply body. */
const MESSAGE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

// --- V1/V2 personas resolved from the intent registry (server-side prompt). ---
const V1_PERSONA = 'companion-proxy-message'
const V2_PERSONA = 'companion-proxy-reply'

/* Companion names are user-authored free text (setup only trims + length-checks),
   but proxy threads snapshot them into a PUBLIC signature. Publish-side gate,
   mirroring arcade-profile's sanitizeArcadePublicLabel rules (no @ / URLs,
   letters-numbers-basic-punct only, 28-char cap) with a companion-appropriate
   neutral fallback instead of a player label. */
const COMPANION_NAME_MAX_LENGTH = 28
const COMPANION_NAME_FALLBACK = '伙伴'
export function sanitizeCompanionPublicName(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, ' ')
  if (trimmed.length === 0) return COMPANION_NAME_FALLBACK
  if (trimmed.includes('@') || /^https?:\/\//i.test(trimmed)) return COMPANION_NAME_FALLBACK
  const safe = Array.from(trimmed)
    .filter((char) => /[\p{L}\p{N} _.'-]/u.test(char))
    .join('')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, COMPANION_NAME_MAX_LENGTH)
  return safe.length > 0 ? safe : COMPANION_NAME_FALLBACK
}

// --- Injected dependency shapes ----------------------------------------------

export interface CompanionProxyMessageDeps {
  sessionReader: SessionReader
  rateLimiter: IntentRateLimiter
  /** Game-global companion read (gameId omitted): identity + cross-game memory. */
  resolveCompanionContext: (userId: string) => Promise<CompanionContext | null>
  readPublicProfile: (userId: string) => Promise<ArcadePublicProfileStatus>
  readCandidates: (authorUserId: string) => Promise<ProxyCandidateEvent[]>
  countAuthorMessagesForDay: (authorUserId: string) => Promise<number>
  insertMessage: (input: InsertProxyMessageInput) => Promise<InsertProxyResult>
  newMessageId: () => string
  llm: LlmProvider
  nowMs?: () => number
  logger?: (entry: ProxyIntentLog) => void
}

export interface CompanionProxyReplyDeps {
  sessionReader: SessionReader
  rateLimiter: IntentRateLimiter
  resolveCompanionContext: (userId: string) => Promise<CompanionContext | null>
  readPublicProfile: (userId: string) => Promise<ArcadePublicProfileStatus>
  loadMessage: (messageId: string) => Promise<ProxyMessageRecord | null>
  findInWindowEvent: (eventId: string) => Promise<ArcadeCommunityFeedItem | null>
  insertReply: (input: InsertProxyReplyInput) => Promise<InsertProxyResult>
  llm: LlmProvider
  nowMs?: () => number
  logger?: (entry: ProxyIntentLog) => void
}

/** Privacy-safe structured log line — outcome only, never user text or ids. */
export interface ProxyIntentLog {
  event: 'companion-proxy-message' | 'companion-proxy-reply'
  outcome: string
  latencyMs: number
}

// --- Response bodies ----------------------------------------------------------

export type CompanionProxyMessageResponse =
  | { messaged: false }
  | {
      messaged: true
      message_id: string
      target_event: {
        /** The community event_id (`e`+16hex) the proxy line was left on — lets
            the dock transparency line's 「看看我说了什么」 anchor to the exact
            event on /community without a second feed read. */
        event_id: string
        template: ArcadeCommunityFeedTemplate
        target_public_label: string
        streak_days?: number
        duration_ms?: number
      }
    }

export interface CompanionProxyReplyResponse {
  message_id: string
  reply_public_label: string
  responder_companion_name: string
}

// --- Small bounded-HTTP helpers (mirrors shadow-chase-intent) -----------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint <= 31 || (codePoint >= 127 && codePoint <= 159)) return true
  }
  return false
}

function truncateFlag(text: string): boolean {
  return [...text].length > MAX_PROXY_BODY_CODEPOINTS
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

type BoundedBodyResult = { ok: true; value: unknown } | { ok: false; response: Response }

/** POST + same-origin + application/json + bounded JSON body. Returns the parsed
    body or the precedence-correct error response (405 / 403 / 415 / 413 / 400). */
async function guardBoundedJsonPost(
  request: Request,
  maxBytes: number
): Promise<BoundedBodyResult> {
  if (request.method !== 'POST') {
    return { ok: false, response: jsonResponse({ error: 'method not allowed' }, 405) }
  }
  const url = new URL(request.url)
  if (request.headers.get('Origin') !== url.origin) {
    return { ok: false, response: jsonResponse({ error: 'forbidden origin' }, 403) }
  }
  const mediaType = request.headers.get('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (mediaType !== 'application/json') {
    return { ok: false, response: jsonResponse({ error: 'application/json required' }, 415) }
  }

  const declared = request.headers.get('Content-Length')
  if (declared !== null) {
    const length = Number(declared)
    if (Number.isFinite(length) && length > maxBytes) {
      return { ok: false, response: jsonResponse({ error: 'request too large' }, 413) }
    }
  }
  if (request.body === null) {
    return { ok: false, response: jsonResponse({ error: 'invalid JSON' }, 400) }
  }
  const reader = request.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })
  let text = ''
  let bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > maxBytes) {
        return { ok: false, response: jsonResponse({ error: 'request too large' }, 413) }
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
  } catch {
    return { ok: false, response: jsonResponse({ error: 'invalid JSON' }, 400) }
  } finally {
    try {
      await reader.cancel()
    } catch {
      // Body already closed/errored.
    }
    reader.releaseLock()
  }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false, response: jsonResponse({ error: 'invalid JSON' }, 400) }
  }
}

function serviceUnavailable(): Response {
  return jsonResponse({ error: 'proxy intent service unavailable' }, 503)
}

function defaultLogger(entry: ProxyIntentLog): void {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(entry))
}

type ProxyIdentity = NonNullable<Awaited<ReturnType<SessionReader['resolve']>>>

type IdentityResult = { ok: true; identity: ProxyIdentity } | { ok: false; response: Response }

/** Shared per-request prelude for BOTH proxy routes: resolve the session identity
    (401 anon / 503 reader failure) then consume the KV rate-limit budget (429
    denied / 503 KV failure). Returns the identity or the early error response,
    with the per-route `log` recording the outcome. The bounded-body guard,
    deps-presence check, and per-route body validation stay in each handler (they
    differ per route). */
async function resolveProxyRequestIdentity(
  request: Request,
  deps: { sessionReader: SessionReader; rateLimiter: IntentRateLimiter; nowMs: () => number },
  log: (outcome: string) => void
): Promise<IdentityResult> {
  let identity: Awaited<ReturnType<SessionReader['resolve']>>
  try {
    identity = await deps.sessionReader.resolve(request.headers.get('Cookie'))
  } catch {
    log('auth-unavailable')
    return { ok: false, response: serviceUnavailable() }
  }
  if (identity === null) {
    log('unauthenticated')
    return { ok: false, response: jsonResponse({ error: 'authentication required' }, 401) }
  }

  let rateLimit: IntentRateLimitResult
  try {
    rateLimit = await deps.rateLimiter.consume(identity.userId, deps.nowMs())
  } catch {
    log('rate-limit-unavailable')
    return { ok: false, response: serviceUnavailable() }
  }
  if (!rateLimit.allowed) {
    log('rate-limited')
    return { ok: false, response: jsonResponse({ error: 'rate limit exceeded' }, 429) }
  }
  return { ok: true, identity }
}

// --- Prompt assembly + bounded generation ------------------------------------

function buildProxyMessages(
  config: ResolvedIntentConfig,
  publicCtx: PublicProxyContext,
  task: unknown
): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        config.systemPromptConfig.role,
        ...config.systemPromptConfig.ruleTemplate,
        `你的身份与你和主人真实一起玩过的游戏经历（只可依据这些措辞，绝不超出）：${JSON.stringify(publicCtx)}`,
      ].join('\n'),
    },
    { role: 'user', content: JSON.stringify(task) },
  ]
}

type GenerationResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'decline' | 'deadline' | 'provider-error' | 'too-large' | 'control-char' }

class ProxyModelOutputTooLargeError extends Error {}

/**
 * Stream one bounded proxy line. Owns the deadline + abort wiring (client abort
 * propagates, deadline aborts at `PROXY_INTENT_TIMEOUT_MS`). The final text is
 * trimmed, then rejected as `decline` (empty), `control-char`, or `too-large`
 * (over the codepoint cap) — the model may always decline by emitting nothing.
 */
async function generateProxyLine(
  llm: LlmProvider,
  persona: typeof V1_PERSONA | typeof V2_PERSONA,
  publicCtx: PublicProxyContext,
  task: unknown,
  requestSignal: AbortSignal
): Promise<GenerationResult> {
  const config = resolveIntentConfig(persona)
  const messages = buildProxyMessages(config, publicCtx, task)

  const controller = new AbortController()
  let abortReason: 'deadline' | 'client' | undefined
  const abortForClient = (): void => {
    abortReason = 'client'
    if (!controller.signal.aborted) {
      controller.abort(requestSignal.reason ?? new Error('proxy-intent: client aborted'))
    }
  }
  if (requestSignal.aborted) abortForClient()
  else requestSignal.addEventListener('abort', abortForClient, { once: true })
  const deadline = setTimeout(() => {
    abortReason = 'deadline'
    controller.abort(
      new Error(`proxy-intent: deadline exceeded after ${PROXY_INTENT_TIMEOUT_MS}ms`)
    )
  }, PROXY_INTENT_TIMEOUT_MS)

  const iterator = llm
    .streamCompletion({
      model: config.llm.model,
      messages,
      temperature: 0,
      signal: controller.signal,
    })
    [Symbol.asyncIterator]()
  let text = ''
  try {
    for (;;) {
      const result = await iterator.next()
      if (result.done) break
      const chunk: LlmCompletionChunk = result.value
      if (chunk.content) {
        text += chunk.content
        if (new TextEncoder().encode(text).byteLength > MAX_PROXY_MODEL_OUTPUT_BYTES) {
          throw new ProxyModelOutputTooLargeError('proxy-intent: model output too large')
        }
      }
      if (chunk.done) break
    }
  } catch (error) {
    if (error instanceof ProxyModelOutputTooLargeError) return { ok: false, reason: 'too-large' }
    if (abortReason === 'deadline') return { ok: false, reason: 'deadline' }
    return { ok: false, reason: 'provider-error' }
  } finally {
    clearTimeout(deadline)
    requestSignal.removeEventListener('abort', abortForClient)
    try {
      await iterator.return?.()
    } catch {
      // Provider generator already aborted/errored; its own cleanup ran.
    }
  }

  const trimmed = text.trim()
  if (trimmed === '') return { ok: false, reason: 'decline' }
  if (containsControlCharacter(trimmed)) return { ok: false, reason: 'control-char' }
  if (truncateFlag(trimmed)) return { ok: false, reason: 'too-large' }
  return { ok: true, text: trimmed }
}

/** Latency metric helper (`nowMs` is injected for deterministic tests). */
function elapsed(startedAt: number, nowMs: () => number): number {
  return Math.max(0, nowMs() - startedAt)
}

function hasPublicLabel(
  profile: ArcadePublicProfileStatus
): profile is { claimed: true; public_label: string } {
  return (
    profile.claimed && typeof profile.public_label === 'string' && profile.public_label.length > 0
  )
}

// --- V1: companion proxy message (background, silent) ------------------------

export async function handleCompanionProxyMessage(
  request: Request,
  deps: Partial<CompanionProxyMessageDeps>
): Promise<Response> {
  const nowMs = deps.nowMs ?? Date.now
  const startedAt = nowMs()
  const logger = deps.logger ?? defaultLogger
  const log = (outcome: string): void =>
    logger({ event: 'companion-proxy-message', outcome, latencyMs: elapsed(startedAt, nowMs) })
  const notMessaged = (outcome: string): Response => {
    log(outcome)
    return jsonResponse({ messaged: false } satisfies CompanionProxyMessageResponse, 200)
  }

  const body = await guardBoundedJsonPost(request, MAX_PROXY_REQUEST_BYTES)
  if (!body.ok) return body.response
  // V1 carries no fields — the trigger is the session, not a payload.
  if (!isRecord(body.value) || Object.keys(body.value).length !== 0) {
    return jsonResponse({ error: 'invalid request body' }, 400)
  }

  const {
    sessionReader,
    rateLimiter,
    resolveCompanionContext,
    readPublicProfile,
    readCandidates,
    countAuthorMessagesForDay,
    insertMessage,
    newMessageId,
    llm,
  } = deps
  if (
    !sessionReader ||
    !rateLimiter ||
    !resolveCompanionContext ||
    !readPublicProfile ||
    !readCandidates ||
    !countAuthorMessagesForDay ||
    !insertMessage ||
    !newMessageId ||
    !llm
  ) {
    log('dependency-unavailable')
    return serviceUnavailable()
  }

  const prelude = await resolveProxyRequestIdentity(
    request,
    { sessionReader, rateLimiter, nowMs },
    log
  )
  if (!prelude.ok) return prelude.response
  const identity = prelude.identity

  let authCtx: CompanionContext | null
  try {
    authCtx = await resolveCompanionContext(identity.userId)
  } catch {
    log('companion-unavailable')
    return serviceUnavailable()
  }
  if (authCtx === null) return notMessaged('no-companion')

  let authPublic: ArcadePublicProfileStatus
  try {
    authPublic = await readPublicProfile(identity.userId)
  } catch {
    log('public-profile-unavailable')
    return serviceUnavailable()
  }
  if (!hasPublicLabel(authPublic)) return notMessaged('no-public-profile')

  let candidates: ProxyCandidateEvent[]
  let dailyCount: number
  try {
    candidates = await readCandidates(identity.userId)
    dailyCount = await countAuthorMessagesForDay(identity.userId)
  } catch {
    log('candidate-read-unavailable')
    return serviceUnavailable()
  }
  if (dailyCount >= DAILY_PROXY_CAP) return notMessaged('daily-cap')
  if (candidates.length === 0) return notMessaged('no-candidate')

  // Deterministic pick: the most recent qualifying event (candidates are feed
  // order, newest-first).
  const target = candidates[0]
  const publicCtx = filterPublicGenerationContext(authCtx)
  const task = {
    owner_label: authPublic.public_label,
    event: {
      template: target.template,
      target_public_label: target.target_public_label,
      at: target.at,
      ...(target.duration_ms !== undefined ? { duration_ms: target.duration_ms } : {}),
      ...(target.streak_days !== undefined ? { streak_days: target.streak_days } : {}),
    },
  }

  const generated = await generateProxyLine(llm, V1_PERSONA, publicCtx, task, request.signal)
  if (!generated.ok) return notMessaged(`generation-${generated.reason}`)

  const buildInput = (id: string): InsertProxyMessageInput => ({
    messageId: id,
    eventId: target.event_id,
    anchorSourceKey: target.anchor_source_key,
    authorUserId: identity.userId,
    authorCompanionName: sanitizeCompanionPublicName(authCtx.companion.name),
    authorPublicLabel: authPublic.public_label,
    targetUserId: target.target_user_id,
    body: generated.text,
  })
  let messageId = newMessageId()
  let insertResult: InsertProxyResult
  try {
    insertResult = await insertMessage(buildInput(messageId))
    // A freshly-minted message_id colliding on the PRIMARY KEY is an id clash,
    // NOT a real (event, author) duplicate — regenerate the id and retry once.
    if (!insertResult.inserted && insertResult.reason === 'id-collision') {
      messageId = newMessageId()
      insertResult = await insertMessage(buildInput(messageId))
    }
  } catch {
    log('insert-unavailable')
    return serviceUnavailable()
  }
  // UNIQUE(event_id, author_user_id) duplicate (or a vanishingly-improbable second
  // id collision) → idempotent skip.
  if (!insertResult.inserted) return notMessaged('duplicate')

  log('messaged')
  return jsonResponse(
    {
      messaged: true,
      message_id: messageId,
      target_event: {
        event_id: target.event_id,
        template: target.template,
        target_public_label: target.target_public_label,
        ...(target.streak_days !== undefined ? { streak_days: target.streak_days } : {}),
        ...(target.duration_ms !== undefined ? { duration_ms: target.duration_ms } : {}),
      },
    } satisfies CompanionProxyMessageResponse,
    200
  )
}

// --- V2: companion proxy reply (user-initiated, explicit codes) --------------

export async function handleCompanionProxyReply(
  request: Request,
  deps: Partial<CompanionProxyReplyDeps>
): Promise<Response> {
  const nowMs = deps.nowMs ?? Date.now
  const startedAt = nowMs()
  const logger = deps.logger ?? defaultLogger
  const log = (outcome: string): void =>
    logger({ event: 'companion-proxy-reply', outcome, latencyMs: elapsed(startedAt, nowMs) })

  const body = await guardBoundedJsonPost(request, MAX_PROXY_REQUEST_BYTES)
  if (!body.ok) return body.response
  if (
    !isRecord(body.value) ||
    Object.keys(body.value).length !== 1 ||
    typeof body.value.message_id !== 'string' ||
    !MESSAGE_ID_PATTERN.test(body.value.message_id)
  ) {
    return jsonResponse({ error: 'invalid request body' }, 400)
  }
  const messageId = body.value.message_id

  const {
    sessionReader,
    rateLimiter,
    resolveCompanionContext,
    readPublicProfile,
    loadMessage,
    findInWindowEvent,
    insertReply,
    llm,
  } = deps
  if (
    !sessionReader ||
    !rateLimiter ||
    !resolveCompanionContext ||
    !readPublicProfile ||
    !loadMessage ||
    !findInWindowEvent ||
    !insertReply ||
    !llm
  ) {
    log('dependency-unavailable')
    return serviceUnavailable()
  }

  const prelude = await resolveProxyRequestIdentity(
    request,
    { sessionReader, rateLimiter, nowMs },
    log
  )
  if (!prelude.ok) return prelude.response
  const identity = prelude.identity

  let message: ProxyMessageRecord | null
  try {
    message = await loadMessage(messageId)
  } catch {
    log('message-read-unavailable')
    return serviceUnavailable()
  }
  if (message === null) {
    log('message-not-found')
    return jsonResponse({ error: 'message not found' }, 404)
  }
  if (identity.userId !== message.target_user_id) {
    log('not-owner')
    return jsonResponse({ error: 'not the event owner' }, 403)
  }
  if (message.has_reply) {
    log('already-replied')
    return jsonResponse({ reason: 'already-replied' }, 409)
  }

  let feedItem: ArcadeCommunityFeedItem | null
  try {
    feedItem = await findInWindowEvent(message.event_id)
  } catch {
    log('feed-read-unavailable')
    return serviceUnavailable()
  }
  if (feedItem === null) {
    log('anchor-out-of-window')
    return jsonResponse({ error: 'anchor out of window' }, 410)
  }

  let respCtx: CompanionContext | null
  try {
    respCtx = await resolveCompanionContext(identity.userId)
  } catch {
    log('companion-unavailable')
    return serviceUnavailable()
  }
  if (respCtx === null) {
    log('no-companion')
    return jsonResponse({ reason: 'no-companion' }, 409)
  }

  let respPublic: ArcadePublicProfileStatus
  try {
    respPublic = await readPublicProfile(identity.userId)
  } catch {
    log('public-profile-unavailable')
    return serviceUnavailable()
  }
  if (!hasPublicLabel(respPublic)) {
    log('no-public-profile')
    return jsonResponse({ reason: 'no-public-profile' }, 409)
  }

  const publicCtx = filterPublicGenerationContext(respCtx)
  const task = {
    owner_label: respPublic.public_label,
    event: {
      template: feedItem.template,
      public_label: feedItem.public_label,
      at: feedItem.at,
      ...(feedItem.duration_ms !== undefined ? { duration_ms: feedItem.duration_ms } : {}),
      ...(feedItem.streak_days !== undefined ? { streak_days: feedItem.streak_days } : {}),
    },
    incoming: message.body,
  }

  const generated = await generateProxyLine(llm, V2_PERSONA, publicCtx, task, request.signal)
  if (!generated.ok) {
    log(`generation-${generated.reason}`)
    return jsonResponse({ error: 'proxy generation failed' }, 502)
  }

  let insertResult: InsertProxyResult
  try {
    insertResult = await insertReply({
      messageId: message.message_id,
      responderCompanionName: sanitizeCompanionPublicName(respCtx.companion.name),
      responderPublicLabel: respPublic.public_label,
      body: generated.text,
    })
  } catch {
    log('insert-unavailable')
    return serviceUnavailable()
  }
  if (!insertResult.inserted) {
    // Concurrent second reply (message_id PK) → already-replied; a vanished
    // parent (defense-in-depth) → 404, same as a missing load.
    if (insertResult.reason === 'duplicate') {
      log('already-replied')
      return jsonResponse({ reason: 'already-replied' }, 409)
    }
    log('message-not-found')
    return jsonResponse({ error: 'message not found' }, 404)
  }

  log('replied')
  return jsonResponse(
    {
      message_id: message.message_id,
      reply_public_label: respPublic.public_label,
      responder_companion_name: sanitizeCompanionPublicName(respCtx.companion.name),
    } satisfies CompanionProxyReplyResponse,
    200
  )
}
