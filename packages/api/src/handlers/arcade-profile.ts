import type {
  ArcadeProfileClaimResponse,
  ArcadeProfileResponse,
  ArcadeStreakLeaderboardResponse,
} from '@amiclaw/arcade-profile/types'
import type { ArcadeProfileDb } from '@amiclaw/arcade-profile/store'
import {
  readArcadeAccountProfile,
  readArcadePublicProfile,
  readArcadeStreakLeaderboard,
  upsertArcadeProfileEvents,
  upsertArcadePublicProfile,
} from '@amiclaw/arcade-profile/store'
import {
  sanitizeArcadePublicLabel,
  parseArcadeProfileClaimBody,
  parseArcadeProfileEvent,
} from '@amiclaw/arcade-profile/validation'
import { requireSession } from '../auth/require-session'
import { jsonResponse } from '../auth/respond'
import { parseJsonBody } from './companion-shared'

export interface ArcadeProfileApiEnv {
  AUTH: KVNamespace
  /** Account data plane D1. The current Pages binding name is COMPANION_DB. */
  COMPANION_DB: ArcadeProfileDb
}

export async function handleGetArcadeProfile(
  request: Request,
  env: ArcadeProfileApiEnv
): Promise<Response> {
  const auth = await requireSession(env.AUTH, request)
  if (!auth.ok) return auth.response

  const [profile, publicProfile] = await Promise.all([
    readArcadeAccountProfile(env.COMPANION_DB, auth.session.user_id),
    readArcadePublicProfile(env.COMPANION_DB, auth.session.user_id),
  ])
  const body: ArcadeProfileResponse = { profile, public_profile: publicProfile }
  return jsonResponse(body, 200, { 'Cache-Control': 'no-store' })
}

export async function handlePostArcadeProfileEvent(
  request: Request,
  env: ArcadeProfileApiEnv
): Promise<Response> {
  const auth = await requireSession(env.AUTH, request)
  if (!auth.ok) return auth.response

  const body = await parseJsonBody(request)
  const event = parseArcadeProfileEvent(body)
  if (!event) return jsonResponse({ error: 'invalid arcade profile event' }, 422)

  await upsertArcadeProfileEvents(env.COMPANION_DB, auth.session.user_id, [event], {
    profileId: event.profile_id,
  })
  const [profile, publicProfile] = await Promise.all([
    readArcadeAccountProfile(env.COMPANION_DB, auth.session.user_id),
    readArcadePublicProfile(env.COMPANION_DB, auth.session.user_id),
  ])
  const response: ArcadeProfileResponse = { profile, public_profile: publicProfile }
  return jsonResponse(response, 200, { 'Cache-Control': 'no-store' })
}

export async function handlePostArcadeProfileClaim(
  request: Request,
  env: ArcadeProfileApiEnv
): Promise<Response> {
  const auth = await requireSession(env.AUTH, request)
  if (!auth.ok) return auth.response

  const body = await parseJsonBody(request)
  const claim = parseArcadeProfileClaimBody(body)
  if (!claim) return jsonResponse({ error: 'invalid arcade profile claim' }, 422)

  const result = await upsertArcadeProfileEvents(
    env.COMPANION_DB,
    auth.session.user_id,
    claim.events,
    { profileId: claim.profile_id }
  )
  const existingPublicProfile = await readArcadePublicProfile(
    env.COMPANION_DB,
    auth.session.user_id
  )
  const publicLabel =
    claim.public_label === undefined &&
    existingPublicProfile.claimed &&
    existingPublicProfile.public_label
      ? existingPublicProfile.public_label
      : sanitizeArcadePublicLabel(claim.public_label, auth.session.user_id)
  const publicProfile = await upsertArcadePublicProfile(env.COMPANION_DB, auth.session.user_id, {
    profileId: claim.profile_id,
    publicLabel,
  })
  const profile = await readArcadeAccountProfile(env.COMPANION_DB, auth.session.user_id)
  const response: ArcadeProfileClaimResponse = {
    profile,
    source_keys: result.sourceKeys,
    inserted: result.inserted,
    public_profile: {
      claimed: true,
      public_label: publicProfile.public_label as string,
    },
  }
  return jsonResponse(response, 200, { 'Cache-Control': 'no-store' })
}

export async function handleGetArcadeStreakLeaderboard(
  request: Request,
  env: ArcadeProfileApiEnv
): Promise<Response> {
  const url = new URL(request.url)
  const date = url.searchParams.get('date') ?? undefined
  const rawLimit = url.searchParams.get('limit')
  const limit = rawLimit === null ? undefined : Number(rawLimit)
  if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return jsonResponse({ error: 'invalid date' }, 422)
  }
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100)) {
    return jsonResponse({ error: 'invalid limit' }, 422)
  }

  const body: ArcadeStreakLeaderboardResponse = await readArcadeStreakLeaderboard(
    env.COMPANION_DB,
    { date, limit }
  )
  return jsonResponse(body, 200, { 'Cache-Control': 'no-store' })
}
