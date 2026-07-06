import type {
  ArcadeProfileClaimResponse,
  ArcadeProfileResponse,
} from '@amiclaw/arcade-profile/types'
import type { ArcadeProfileDb } from '@amiclaw/arcade-profile/store'
import { readArcadeAccountProfile, upsertArcadeProfileEvents } from '@amiclaw/arcade-profile/store'
import {
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

  const profile = await readArcadeAccountProfile(env.COMPANION_DB, auth.session.user_id)
  const body: ArcadeProfileResponse = { profile }
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
  const profile = await readArcadeAccountProfile(env.COMPANION_DB, auth.session.user_id)
  const response: ArcadeProfileResponse = { profile }
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
  const profile = await readArcadeAccountProfile(env.COMPANION_DB, auth.session.user_id)
  const response: ArcadeProfileClaimResponse = {
    profile,
    source_keys: result.sourceKeys,
    inserted: result.inserted,
  }
  return jsonResponse(response, 200, { 'Cache-Control': 'no-store' })
}
