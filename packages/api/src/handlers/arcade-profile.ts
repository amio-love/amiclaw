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
  resolveArcadePublicLabel,
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
  // Settlement events are a best-effort, fire-and-forget account sync fired
  // after EVERY run/sign, including anonymous ones — but an anonymous session
  // has no account to attach them to (they live in the device-local profile and
  // sync on the login claim instead). Answer 204 (accepted, nothing to persist
  // or return) rather than 401 so an anonymous player does not spray a red 401
  // into the console after every settlement (audit F27). The client reads 204 as
  //「not synced (anonymous)」and keeps its local record. GET profile / POST claim
  // keep 401 — those are genuine authenticated reads/writes.
  if (!auth.ok) return new Response(null, { status: 204 })

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
  // Honest label precedence: chosen nickname (client) > existing real name >
  // account email local-part > anonymous placeholder. A logged-in user never
  // lands on `Player XXXX`, and an existing placeholder row is upgraded here.
  const publicLabel = resolveArcadePublicLabel({
    clientLabel: claim.public_label,
    existingLabel: existingPublicProfile.claimed ? existingPublicProfile.public_label : null,
    email: auth.session.email,
    userId: auth.session.user_id,
  })
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
