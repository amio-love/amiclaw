import type {
  ArcadeCommunityFeedResponse,
  ArcadeCommunityLikeResponse,
} from '@amiclaw/arcade-profile/types'
import {
  likeArcadeCommunityEvent,
  parseCommunityCursor,
  readArcadeCommunityFeed,
  unlikeArcadeCommunityEvent,
} from '@amiclaw/arcade-profile/store'
import { parseCommunityLikeBody } from '@amiclaw/arcade-profile/validation'
import type { ArcadeProfileApiEnv } from './arcade-profile'
import { readSessionFromRequest } from '../auth/session'
import { requireSession } from '../auth/require-session'
import { jsonResponse } from '../auth/respond'
import { parseJsonBody } from './companion-shared'

const FEED_MAX_LIMIT = 50

/**
 * GET /api/arcade/community/feed — the real, derived community event stream.
 *
 * Anonymous is legal: the feed is public and identifies players only by the
 * privacy-vetted public_label. A session, when present, is read to derive the
 * viewer's per-item state server-side — `liked`, `viewer_is_owner`,
 * `viewer_has_companion`, and each proxy thread's `can_reply` — never to gate the
 * read and never required. The response never exposes `user_id`, email, or
 * `profile_id`.
 */
export async function handleGetArcadeCommunityFeed(
  request: Request,
  env: ArcadeProfileApiEnv
): Promise<Response> {
  const url = new URL(request.url)
  const before = url.searchParams.get('before') ?? undefined
  const rawLimit = url.searchParams.get('limit')
  const limit = rawLimit === null ? undefined : Number(rawLimit)

  if (before !== undefined && parseCommunityCursor(before) === null) {
    return jsonResponse({ error: 'invalid before cursor' }, 422)
  }
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > FEED_MAX_LIMIT)) {
    return jsonResponse({ error: 'invalid limit' }, 422)
  }

  // Optional viewer identity — a read never requires a session.
  const session = await readSessionFromRequest(env.AUTH, request)
  const body: ArcadeCommunityFeedResponse = await readArcadeCommunityFeed(env.COMPANION_DB, {
    before,
    limit,
    viewerUserId: session?.user_id,
  })
  return jsonResponse(body, 200, { 'Cache-Control': 'no-store' })
}

/**
 * POST /api/arcade/community/likes — like a feed event (login required).
 *
 * Liking is the one real, persistent interaction. The liker identity is the
 * server-side session's user_id, never the body; the body carries only the
 * opaque event id. Idempotent: a re-like is a no-op (composite PK dedup).
 */
export async function handlePostArcadeCommunityLike(
  request: Request,
  env: ArcadeProfileApiEnv
): Promise<Response> {
  const auth = await requireSession(env.AUTH, request)
  if (!auth.ok) return auth.response

  const parsed = parseCommunityLikeBody(await parseJsonBody(request))
  if (!parsed) return jsonResponse({ error: 'invalid like' }, 422)

  const like: ArcadeCommunityLikeResponse = await likeArcadeCommunityEvent(
    env.COMPANION_DB,
    auth.session.user_id,
    parsed.event_id
  )
  return jsonResponse(like, 200, { 'Cache-Control': 'no-store' })
}

/**
 * DELETE /api/arcade/community/likes — remove the viewer's like (login required,
 * idempotent). A like the player set is theirs to undo; comments / human posts
 * are deliberately NOT built until there is a user base.
 */
export async function handleDeleteArcadeCommunityLike(
  request: Request,
  env: ArcadeProfileApiEnv
): Promise<Response> {
  const auth = await requireSession(env.AUTH, request)
  if (!auth.ok) return auth.response

  const parsed = parseCommunityLikeBody(await parseJsonBody(request))
  if (!parsed) return jsonResponse({ error: 'invalid like' }, 422)

  const like: ArcadeCommunityLikeResponse = await unlikeArcadeCommunityEvent(
    env.COMPANION_DB,
    auth.session.user_id,
    parsed.event_id
  )
  return jsonResponse(like, 200, { 'Cache-Control': 'no-store' })
}
