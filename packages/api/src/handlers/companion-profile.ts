/**
 * /api/companion/profile — the understanding-layer control plane
 * (L2 §Mechanism Variant 4, "view" + "switch off" + the bulk half of "delete"
 * of the four player-sovereign operations).
 *
 *   GET    — every active claim WITH its evidence chain: each understanding
 *            links back to the visible memories it came from.
 *   PUT    — the profile switch (`profile_enabled`). Off = claim consolidation
 *            AND claim injection stop immediately; existing claims are dormant
 *            (gated at every read), visible memories are untouched.
 *   DELETE — hard-delete the user's ENTIRE profile (every claim, any status);
 *            evidence links cascade away, identical to the per-claim delete.
 *            Idempotent: re-deleting an empty profile removes zero rows.
 */

import type { ProfileResponse } from '../../../companion-memory/src/types'
import {
  deleteAllClaims,
  getCompanion,
  listActiveClaimsWithEvidence,
  setProfileEnabled,
} from '../../../companion-memory/src/store'
import { requireSession } from '../auth/require-session'
import { jsonResponse } from '../auth/respond'
import { parseJsonBody, type CompanionApiEnv } from './companion-shared'

export async function handleGetProfile(request: Request, env: CompanionApiEnv): Promise<Response> {
  const auth = await requireSession(env.AUTH, request)
  if (!auth.ok) return auth.response

  const companion = await getCompanion(env.COMPANION_DB, auth.session.user_id)
  if (companion === null) {
    return jsonResponse({ error: 'no companion set up' }, 404)
  }
  const claims = await listActiveClaimsWithEvidence(env.COMPANION_DB, auth.session.user_id)
  const body: ProfileResponse = {
    profile_enabled: companion.profile_enabled === 1,
    claims,
  }
  return jsonResponse(body, 200, { 'Cache-Control': 'no-store' })
}

export async function handlePutProfileSettings(
  request: Request,
  env: CompanionApiEnv
): Promise<Response> {
  const auth = await requireSession(env.AUTH, request)
  if (!auth.ok) return auth.response

  const body = await parseJsonBody(request)
  const profileEnabled = (body as { profile_enabled?: unknown } | null)?.profile_enabled
  if (typeof profileEnabled !== 'boolean') {
    return jsonResponse({ error: 'profile_enabled must be a boolean' }, 422)
  }

  const updated = await setProfileEnabled(env.COMPANION_DB, auth.session.user_id, profileEnabled)
  if (!updated) {
    return jsonResponse({ error: 'no companion set up' }, 404)
  }
  return jsonResponse({ profile_enabled: profileEnabled }, 200)
}

export async function handleDeleteProfile(
  request: Request,
  env: CompanionApiEnv
): Promise<Response> {
  const auth = await requireSession(env.AUTH, request)
  if (!auth.ok) return auth.response

  const deleted = await deleteAllClaims(env.COMPANION_DB, auth.session.user_id)
  return jsonResponse({ deleted }, 200)
}
