import type {
  ArcadeProfileClaimResponse,
  ArcadeProfileEventResponse,
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
import { qualifiedBombSquadRunDate, qualifiedOracleSignDate } from '@amiclaw/arcade-profile/summary'
import {
  resolveArcadePublicLabel,
  parseArcadeProfileClaimBody,
  parseArcadeProfileEvent,
} from '@amiclaw/arcade-profile/validation'
import { getTodayString } from '../../../../shared/date'
import { creditCheckinReward } from '../../../companion-memory/src/ledger'
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
  // An anonymous read has no account profile to resolve. Answer 204 (accepted,
  // no content) rather than 401 so an anonymous player's settlement never paints
  // a red 401 into the console on every win — mirroring the settlement-event
  // endpoint below (audit F27). The client reads 204 as `anon` and keeps its
  // device-local record. POST claim keeps 401 — it is a genuine authenticated
  // write, not a legal anonymous read. no-store: the anon-vs-authed answer
  // varies by cookie, so a shared cache must never reuse it.
  if (!auth.ok) return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })

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

  // Check-in reward (+3): the FIRST qualified activity of the UTC day credits
  // once, keyed on `checkin:{userId}:{today}` (design §4). Qualification reuses
  // the streak's SSOT helpers so check-in and streak can never disagree — a
  // practice/exploded run, a past-dated sign, or a same-day event whose product
  // day is not today never triggers it. Fail-open: the ledger credit is wrapped
  // so the profile write always succeeds even if the asset ledger is
  // unavailable; the reward is simply omitted on any failure.
  const today = getTodayString()
  const qualifiedDate =
    event.kind === 'bombsquad_run'
      ? qualifiedBombSquadRunDate(event.run)?.date
      : qualifiedOracleSignDate(event.sign)?.date
  let checkinReward: ArcadeProfileEventResponse['checkin_reward']
  if (qualifiedDate === today) {
    try {
      checkinReward = await creditCheckinReward(env.COMPANION_DB, auth.session.user_id, today)
    } catch {
      checkinReward = undefined
    }
  }

  const [profile, publicProfile] = await Promise.all([
    readArcadeAccountProfile(env.COMPANION_DB, auth.session.user_id),
    readArcadePublicProfile(env.COMPANION_DB, auth.session.user_id),
  ])
  const response: ArcadeProfileEventResponse = {
    profile,
    public_profile: publicProfile,
    ...(checkinReward ? { checkin_reward: checkinReward } : {}),
  }
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
