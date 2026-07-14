import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CompanionContext } from '../../companion-memory/src/types'
import type {
  InsertProxyMessageInput,
  InsertProxyResult,
  ProxyCandidateEvent,
  ProxyMessageRecord,
} from '../../arcade-profile/src/store'
import type {
  ArcadeCommunityFeedItem,
  ArcadePublicProfileStatus,
} from '../../arcade-profile/src/types'
import type { SessionReader } from './auth-seam'
import type { IntentRateLimiter } from './shadow-chase-intent-rate-limit'
import type { LlmCompletionRequest, LlmProvider } from './providers/types'
import {
  DAILY_PROXY_CAP,
  handleCompanionProxyMessage,
  handleCompanionProxyReply,
  MAX_PROXY_BODY_CODEPOINTS,
  MAX_PROXY_REQUEST_BYTES,
  PROXY_INTENT_TIMEOUT_MS,
  sanitizeCompanionPublicName,
  type CompanionProxyMessageDeps,
  type CompanionProxyReplyDeps,
} from './companion-proxy-intent'

const ORIGIN = 'https://claw.amio.fans'

function request(path: string, body: unknown = {}, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: {
      Origin: ORIGIN,
      'Content-Type': 'application/json; charset=utf-8',
      Cookie: 'amiclaw_session=session-a',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const V1_PATH = '/ai-intent/companion-proxy-message'
const V2_PATH = '/ai-intent/companion-proxy-reply'

function providerFor(output: string): LlmProvider {
  return {
    async *streamCompletion(): AsyncIterable<{ content: string; done: boolean }> {
      yield { content: output, done: false }
      yield { content: '', done: true }
    },
  }
}

function capturingProvider(output: string): {
  provider: LlmProvider
  calls: LlmCompletionRequest[]
} {
  const calls: LlmCompletionRequest[] = []
  return {
    calls,
    provider: {
      async *streamCompletion(req: LlmCompletionRequest) {
        calls.push(req)
        yield { content: output, done: false }
        yield { content: '', done: true }
      },
    },
  }
}

const COMPANION: CompanionContext = {
  companion: { name: 'Nova', address_style: 'friend', voice_id: 'companion-warm' },
  claims: [{ dimension: 'style', claim: 'SECRET-CLAIM' }],
  episodes: [
    {
      title: 'The last-second defuse',
      narrative: 'clutch wire',
      occurred_at: '2026-07-01T00:00:00.000Z',
      game_id: 'bombsquad',
      source_kind: 'settlement',
      salience: 90,
    },
  ],
}

const CLAIMED: ArcadePublicProfileStatus = { claimed: true, public_label: 'Jia the Bold' }
const UNCLAIMED: ArcadePublicProfileStatus = { claimed: false, public_label: null }

function candidate(overrides: Partial<ProxyCandidateEvent> = {}): ProxyCandidateEvent {
  return {
    event_id: 'e00000000000000a',
    anchor_source_key: 'bombsquad:run-1',
    target_user_id: 'user-yi',
    template: 'leaderboard_entry',
    target_public_label: 'Yi',
    at: '2026-07-08T08:00:00.000Z',
    ...overrides,
  }
}

function messageDeps(
  overrides: Partial<CompanionProxyMessageDeps> = {}
): CompanionProxyMessageDeps {
  const sessionReader: SessionReader = { resolve: vi.fn(async () => ({ userId: 'user-jia' })) }
  const rateLimiter: IntentRateLimiter = {
    consume: vi.fn(async () => ({ allowed: true, count: 1, limit: 12 })),
  }
  return {
    sessionReader,
    rateLimiter,
    resolveCompanionContext: vi.fn(async () => COMPANION),
    readPublicProfile: vi.fn(async () => CLAIMED),
    readCandidates: vi.fn(async () => [candidate()]),
    countAuthorMessagesForDay: vi.fn(async () => 0),
    insertMessage: vi.fn(async () => ({ inserted: true }) as InsertProxyResult),
    newMessageId: vi.fn(() => 'msg-new'),
    llm: providerFor('替你道一句漂亮！'),
    nowMs: vi.fn(() => 10_000),
    logger: vi.fn(),
    ...overrides,
  }
}

function feedItem(overrides: Partial<ArcadeCommunityFeedItem> = {}): ArcadeCommunityFeedItem {
  return {
    id: 'e00000000000000a',
    template: 'leaderboard_entry',
    public_label: 'Yi',
    at: '2026-07-08T08:00:00.000Z',
    like_count: 0,
    liked: false,
    threads: [],
    viewer_is_owner: true,
    viewer_has_companion: true,
    ...overrides,
  }
}

function messageRecord(overrides: Partial<ProxyMessageRecord> = {}): ProxyMessageRecord {
  return {
    message_id: 'msg-1',
    event_id: 'e00000000000000a',
    author_user_id: 'user-jia',
    target_user_id: 'user-yi',
    body: 'INCOMING-LINE',
    created_at: '2026-07-08T10:00:00.000Z',
    has_reply: false,
    ...overrides,
  }
}

function replyDeps(overrides: Partial<CompanionProxyReplyDeps> = {}): CompanionProxyReplyDeps {
  const sessionReader: SessionReader = { resolve: vi.fn(async () => ({ userId: 'user-yi' })) }
  const rateLimiter: IntentRateLimiter = {
    consume: vi.fn(async () => ({ allowed: true, count: 1, limit: 12 })),
  }
  return {
    sessionReader,
    rateLimiter,
    resolveCompanionContext: vi.fn(async () => COMPANION),
    readPublicProfile: vi.fn(async () => ({ claimed: true, public_label: 'Yi' })),
    loadMessage: vi.fn(async () => messageRecord()),
    findInWindowEvent: vi.fn(async () => feedItem()),
    insertReply: vi.fn(async () => ({ inserted: true }) as InsertProxyResult),
    llm: providerFor('谢谢你的伙伴！'),
    nowMs: vi.fn(() => 10_000),
    logger: vi.fn(),
    ...overrides,
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// --- V1: companion proxy message ---------------------------------------------

describe('handleCompanionProxyMessage — happy path + transparency facts', () => {
  it('authors, inserts with the write-time snapshot, and returns target_event', async () => {
    const { provider, calls } = capturingProvider('替你道一句漂亮！')
    const deps = messageDeps({ llm: provider })
    const response = await handleCompanionProxyMessage(request(V1_PATH), deps)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      messaged: true,
      message_id: 'msg-new',
      target_event: {
        event_id: 'e00000000000000a',
        template: 'leaderboard_entry',
        target_public_label: 'Yi',
      },
    })
    expect(deps.insertMessage).toHaveBeenCalledWith({
      messageId: 'msg-new',
      eventId: 'e00000000000000a',
      anchorSourceKey: 'bombsquad:run-1',
      authorUserId: 'user-jia',
      authorCompanionName: 'Nova',
      authorPublicLabel: 'Jia the Bold',
      targetUserId: 'user-yi',
      body: '替你道一句漂亮！',
    })
    // The generation prompt is privacy-filtered: no profile claim, no voice_id.
    const prompt = JSON.stringify(calls[0].messages)
    expect(prompt).not.toContain('SECRET-CLAIM')
    expect(prompt).not.toContain('voice_id')
    expect(prompt).toContain('Jia the Bold')
    // Identity comes only from the session; the resolver is called game-global.
    expect(deps.resolveCompanionContext).toHaveBeenCalledWith('user-jia')
  })

  it('carries duration_ms for daily_clear and streak_days for streak_milestone', async () => {
    const daily = messageDeps({
      readCandidates: vi.fn(async () => [
        candidate({ template: 'daily_clear', duration_ms: 42_000 }),
      ]),
    })
    expect(await (await handleCompanionProxyMessage(request(V1_PATH), daily)).json()).toMatchObject(
      {
        target_event: { template: 'daily_clear', target_public_label: 'Yi', duration_ms: 42_000 },
      }
    )

    const milestone = messageDeps({
      readCandidates: vi.fn(async () => [
        candidate({ template: 'streak_milestone', streak_days: 14 }),
      ]),
    })
    expect(
      await (await handleCompanionProxyMessage(request(V1_PATH), milestone)).json()
    ).toMatchObject({
      target_event: { template: 'streak_milestone', target_public_label: 'Yi', streak_days: 14 },
    })
  })

  it('regenerates the message_id once on an id-collision, then succeeds', async () => {
    // The freshly-minted id clashes on the PK first, a fresh one wins on retry —
    // distinct from a real (event, author) duplicate (which stays messaged:false).
    const newMessageId = vi
      .fn<() => string>()
      .mockReturnValueOnce('msg-clash')
      .mockReturnValueOnce('msg-fresh')
    const insertMessage = vi
      .fn<(input: InsertProxyMessageInput) => Promise<InsertProxyResult>>()
      .mockResolvedValueOnce({ inserted: false, reason: 'id-collision' })
      .mockResolvedValueOnce({ inserted: true })
    const deps = messageDeps({ newMessageId, insertMessage })

    const response = await handleCompanionProxyMessage(request(V1_PATH), deps)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ messaged: true, message_id: 'msg-fresh' })
    expect(newMessageId).toHaveBeenCalledTimes(2)
    expect(insertMessage).toHaveBeenCalledTimes(2)
    expect(insertMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ messageId: 'msg-clash' })
    )
    expect(insertMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ messageId: 'msg-fresh' })
    )
  })
})

describe('handleCompanionProxyMessage — silent background skips (200 messaged:false)', () => {
  it.each([
    [
      'no companion',
      { resolveCompanionContext: vi.fn(async () => null) } as Partial<CompanionProxyMessageDeps>,
    ],
    ['no public profile', { readPublicProfile: vi.fn(async () => UNCLAIMED) }],
    ['no candidate', { readCandidates: vi.fn(async () => []) }],
    ['daily cap reached', { countAuthorMessagesForDay: vi.fn(async () => DAILY_PROXY_CAP) }],
    ['model declines', { llm: providerFor('   ') }],
    [
      'concurrent duplicate insert',
      {
        insertMessage: vi.fn(
          async () => ({ inserted: false, reason: 'duplicate' }) as InsertProxyResult
        ),
      },
    ],
  ])('skips silently: %s', async (_name, override) => {
    const deps = messageDeps(override)
    const response = await handleCompanionProxyMessage(request(V1_PATH), deps)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ messaged: false })
  })

  it('never authors or inserts when the author has no companion', async () => {
    const insertMessage = vi.fn(async () => ({ inserted: true }) as InsertProxyResult)
    const llm = { streamCompletion: vi.fn() } as unknown as LlmProvider
    const deps = messageDeps({
      resolveCompanionContext: vi.fn(async () => null),
      insertMessage,
      llm,
    })
    await handleCompanionProxyMessage(request(V1_PATH), deps)
    expect(llm.streamCompletion).not.toHaveBeenCalled()
    expect(insertMessage).not.toHaveBeenCalled()
  })

  it('does not generate when the daily cap is already reached', async () => {
    const llm = { streamCompletion: vi.fn() } as unknown as LlmProvider
    const deps = messageDeps({ countAuthorMessagesForDay: vi.fn(async () => DAILY_PROXY_CAP), llm })
    await handleCompanionProxyMessage(request(V1_PATH), deps)
    expect(llm.streamCompletion).not.toHaveBeenCalled()
  })
})

describe('handleCompanionProxyMessage — bounded skeleton codes', () => {
  it('401 when anonymous, 429 when rate-limited', async () => {
    const anon = messageDeps({ sessionReader: { resolve: vi.fn(async () => null) } })
    expect((await handleCompanionProxyMessage(request(V1_PATH), anon)).status).toBe(401)

    const limited = messageDeps({
      rateLimiter: { consume: vi.fn(async () => ({ allowed: false, count: 13, limit: 12 })) },
    })
    expect((await handleCompanionProxyMessage(request(V1_PATH), limited)).status).toBe(429)
  })

  it.each([
    ['method', new Request(`${ORIGIN}${V1_PATH}`, { method: 'GET' }), 405],
    ['origin', request(V1_PATH, {}, { Origin: 'https://evil.example' }), 403],
    ['content type', request(V1_PATH, {}, { 'Content-Type': 'text/plain' }), 415],
    ['non-empty body', request(V1_PATH, { unexpected: true }), 400],
  ])('rejects bad %s before model work', async (_name, incoming, status) => {
    const llm = { streamCompletion: vi.fn() } as unknown as LlmProvider
    const response = await handleCompanionProxyMessage(incoming, messageDeps({ llm }))
    expect(response.status).toBe(status)
    expect(llm.streamCompletion).not.toHaveBeenCalled()
  })

  it('rejects an oversize body with 413', async () => {
    const response = await handleCompanionProxyMessage(
      request(V1_PATH, 'x'.repeat(MAX_PROXY_REQUEST_BYTES + 1), {
        'Content-Length': String(MAX_PROXY_REQUEST_BYTES + 1),
      }),
      messageDeps()
    )
    expect(response.status).toBe(413)
  })

  it('503 on missing deps and on a limiter failure, never invoking the model', async () => {
    expect((await handleCompanionProxyMessage(request(V1_PATH), {})).status).toBe(503)

    const llm = { streamCompletion: vi.fn() } as unknown as LlmProvider
    const brokenLimiter = messageDeps({
      llm,
      rateLimiter: { consume: vi.fn(async () => Promise.reject(new Error('KV down'))) },
    })
    expect((await handleCompanionProxyMessage(request(V1_PATH), brokenLimiter)).status).toBe(503)
    expect(llm.streamCompletion).not.toHaveBeenCalled()
  })

  it('aborts a hanging provider at the deadline and skips silently', async () => {
    vi.useFakeTimers()
    let cleaned = false
    const llm: LlmProvider = {
      async *streamCompletion(req: LlmCompletionRequest) {
        try {
          yield { content: '道一句', done: false }
          await new Promise<void>((_resolve, reject) => {
            req.signal?.addEventListener('abort', () => reject(req.signal?.reason), { once: true })
          })
        } finally {
          cleaned = true
        }
      },
    }
    const pending = handleCompanionProxyMessage(request(V1_PATH), messageDeps({ llm }))
    await vi.advanceTimersByTimeAsync(PROXY_INTENT_TIMEOUT_MS)
    const response = await pending
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ messaged: false })
    expect(cleaned).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
})

// --- V2: companion proxy reply -----------------------------------------------

describe('handleCompanionProxyReply — happy path', () => {
  it('replies once and returns the responder signature', async () => {
    const { provider, calls } = capturingProvider('谢谢你的伙伴！')
    const deps = replyDeps({ llm: provider })
    const response = await handleCompanionProxyReply(
      request(V2_PATH, { message_id: 'msg-1' }),
      deps
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      message_id: 'msg-1',
      reply_public_label: 'Yi',
      responder_companion_name: 'Nova',
    })
    expect(deps.insertReply).toHaveBeenCalledWith({
      messageId: 'msg-1',
      responderCompanionName: 'Nova',
      responderPublicLabel: 'Yi',
      body: '谢谢你的伙伴！',
    })
    const prompt = JSON.stringify(calls[0].messages)
    expect(prompt).toContain('INCOMING-LINE') // the incoming proxy line is injected
    expect(prompt).not.toContain('SECRET-CLAIM') // still privacy-filtered
  })
})

describe('handleCompanionProxyReply — explicit error codes', () => {
  it('404 when the message is missing', async () => {
    const deps = replyDeps({ loadMessage: vi.fn(async () => null) })
    expect(
      (await handleCompanionProxyReply(request(V2_PATH, { message_id: 'msg-x' }), deps)).status
    ).toBe(404)
  })

  it('403 when the caller is not the event owner', async () => {
    const deps = replyDeps({
      sessionReader: { resolve: vi.fn(async () => ({ userId: 'user-zzz' })) },
    })
    expect(
      (await handleCompanionProxyReply(request(V2_PATH, { message_id: 'msg-1' }), deps)).status
    ).toBe(403)
  })

  it.each([
    [
      'already-replied',
      replyDeps({ loadMessage: vi.fn(async () => messageRecord({ has_reply: true })) }),
    ],
    ['no-companion', replyDeps({ resolveCompanionContext: vi.fn(async () => null) })],
    [
      'no-public-profile',
      replyDeps({ readPublicProfile: vi.fn(async () => ({ claimed: false, public_label: null })) }),
    ],
  ])('409 with reason %s', async (reason, deps) => {
    const response = await handleCompanionProxyReply(
      request(V2_PATH, { message_id: 'msg-1' }),
      deps
    )
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ reason })
  })

  it('410 when the anchor has slid out of the window', async () => {
    const deps = replyDeps({ findInWindowEvent: vi.fn(async () => null) })
    expect(
      (await handleCompanionProxyReply(request(V2_PATH, { message_id: 'msg-1' }), deps)).status
    ).toBe(410)
  })

  it('prefers 409 already-replied over the 410 window guard (spec order)', async () => {
    const deps = replyDeps({
      loadMessage: vi.fn(async () => messageRecord({ has_reply: true })),
      findInWindowEvent: vi.fn(async () => null),
    })
    const response = await handleCompanionProxyReply(
      request(V2_PATH, { message_id: 'msg-1' }),
      deps
    )
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ reason: 'already-replied' })
  })

  it('502 when the model declines', async () => {
    const deps = replyDeps({ llm: providerFor('') })
    expect(
      (await handleCompanionProxyReply(request(V2_PATH, { message_id: 'msg-1' }), deps)).status
    ).toBe(502)
  })

  it('maps a concurrent-duplicate insert to 409 already-replied', async () => {
    const deps = replyDeps({
      insertReply: vi.fn(
        async () => ({ inserted: false, reason: 'duplicate' }) as InsertProxyResult
      ),
    })
    const response = await handleCompanionProxyReply(
      request(V2_PATH, { message_id: 'msg-1' }),
      deps
    )
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ reason: 'already-replied' })
  })

  it('maps a vanished-parent insert to 404', async () => {
    const deps = replyDeps({
      insertReply: vi.fn(
        async () => ({ inserted: false, reason: 'missing-message' }) as InsertProxyResult
      ),
    })
    expect(
      (await handleCompanionProxyReply(request(V2_PATH, { message_id: 'msg-1' }), deps)).status
    ).toBe(404)
  })

  it('401 anonymous, 429 rate-limited, 503 missing deps', async () => {
    const anon = replyDeps({ sessionReader: { resolve: vi.fn(async () => null) } })
    expect(
      (await handleCompanionProxyReply(request(V2_PATH, { message_id: 'msg-1' }), anon)).status
    ).toBe(401)

    const limited = replyDeps({
      rateLimiter: { consume: vi.fn(async () => ({ allowed: false, count: 13, limit: 12 })) },
    })
    expect(
      (await handleCompanionProxyReply(request(V2_PATH, { message_id: 'msg-1' }), limited)).status
    ).toBe(429)

    expect(
      (await handleCompanionProxyReply(request(V2_PATH, { message_id: 'msg-1' }), {})).status
    ).toBe(503)
  })

  it.each([
    ['missing message_id', request(V2_PATH, {})],
    ['extra key', request(V2_PATH, { message_id: 'msg-1', extra: true })],
    ['bad id shape', request(V2_PATH, { message_id: 'has space' })],
    ['non-string id', request(V2_PATH, { message_id: 123 })],
  ])('rejects an invalid body: %s (400)', async (_name, incoming) => {
    const llm = { streamCompletion: vi.fn() } as unknown as LlmProvider
    const response = await handleCompanionProxyReply(incoming, replyDeps({ llm }))
    expect(response.status).toBe(400)
    expect(llm.streamCompletion).not.toHaveBeenCalled()
  })

  it('does not generate or write on an already-replied fast path', async () => {
    const insertReply = vi.fn(async () => ({ inserted: true }) as InsertProxyResult)
    const llm = { streamCompletion: vi.fn() } as unknown as LlmProvider
    const deps = replyDeps({
      loadMessage: vi.fn(async () => messageRecord({ has_reply: true })),
      insertReply,
      llm,
    })
    await handleCompanionProxyReply(request(V2_PATH, { message_id: 'msg-1' }), deps)
    expect(llm.streamCompletion).not.toHaveBeenCalled()
    expect(insertReply).not.toHaveBeenCalled()
  })

  it('rejects an over-cap generated line as a 502 (codepoint cap)', async () => {
    const deps = replyDeps({ llm: providerFor('字'.repeat(MAX_PROXY_BODY_CODEPOINTS + 1)) })
    expect(
      (await handleCompanionProxyReply(request(V2_PATH, { message_id: 'msg-1' }), deps)).status
    ).toBe(502)
  })
})

/* Publish-side gate for user-authored companion names entering PUBLIC thread
   signatures (codex review P2, 2026-07-14): the setup flow only trims +
   length-checks, so the snapshot must sanitize. */
describe('sanitizeCompanionPublicName', () => {
  it('passes clean names through (unicode letters incl. CJK)', () => {
    expect(sanitizeCompanionPublicName('阿澈')).toBe('阿澈')
    expect(sanitizeCompanionPublicName('  Nova 7 ')).toBe('Nova 7')
  })

  it('falls back to the neutral name on emails and URLs', () => {
    expect(sanitizeCompanionPublicName('spam@example.com')).toBe('伙伴')
    expect(sanitizeCompanionPublicName('https://spam.example')).toBe('伙伴')
    expect(sanitizeCompanionPublicName('   ')).toBe('伙伴')
  })

  it('strips disallowed characters and caps the length at 28', () => {
    expect(sanitizeCompanionPublicName('No<script>va!!')).toBe('Noscriptva')
    expect(sanitizeCompanionPublicName('x'.repeat(60))).toHaveLength(28)
    expect(sanitizeCompanionPublicName('!!!###')).toBe('伙伴')
  })
})
