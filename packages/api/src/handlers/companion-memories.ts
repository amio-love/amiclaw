/**
 * /api/companion/memories — the visible episodic layer (the memory album's
 * data; UI is a downstream task).
 *
 *   GET — keyset-paginated active episodes, newest first.
 *   DELETE <id> — soft-delete one memory; the schema trigger cascades claim
 *        invalidation (a claim whose last active evidence vanishes leaves
 *        'active' and stops injecting).
 */

import { deleteMemory, listMemories } from '../../../companion-memory/src/store'
import type { MemoriesResponse } from '../../../companion-memory/src/types'
import { requireSession } from '../auth/require-session'
import { jsonResponse } from '../auth/respond'
import type { CompanionApiEnv } from './companion-shared'

export async function handleGetMemories(request: Request, env: CompanionApiEnv): Promise<Response> {
  const auth = await requireSession(env.AUTH, request)
  if (!auth.ok) return auth.response

  const url = new URL(request.url)
  const limitRaw = url.searchParams.get('limit')
  const limit = limitRaw === null ? undefined : Number.parseInt(limitRaw, 10)
  const cursor = url.searchParams.get('cursor') ?? undefined
  // `order=oldest` returns earliest-first (the milestone callback's earliest
  // episode); any other value keeps the default newest-first album order.
  const order = url.searchParams.get('order') === 'oldest' ? 'oldest' : undefined

  const page = await listMemories(env.COMPANION_DB, auth.session.user_id, {
    ...(limit !== undefined && Number.isFinite(limit) ? { limit } : {}),
    ...(cursor !== undefined ? { cursor } : {}),
    ...(order !== undefined ? { order } : {}),
  })
  const body: MemoriesResponse = {
    memories: page.memories,
    ...(page.nextCursor !== undefined ? { next_cursor: page.nextCursor } : {}),
  }
  return jsonResponse(body, 200, { 'Cache-Control': 'no-store' })
}

export async function handleMemoryDelete(
  request: Request,
  env: CompanionApiEnv,
  episodeId: string
): Promise<Response> {
  const auth = await requireSession(env.AUTH, request)
  if (!auth.ok) return auth.response

  const deleted = await deleteMemory(env.COMPANION_DB, auth.session.user_id, episodeId)
  if (!deleted) {
    return jsonResponse({ error: 'memory not found' }, 404)
  }
  return jsonResponse({ ok: true }, 200)
}
