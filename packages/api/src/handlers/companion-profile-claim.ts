/**
 * /api/companion/profile/<id>/* — per-claim operations ("correct" + "delete"
 * of the four player-sovereign operations, L2 §Mechanism Variant 4).
 *
 *   POST <id>/correction — the original claim turns 'corrected' (kept as
 *        history); the player's correction lives on as a new active claim
 *        inheriting the original's evidence links.
 *   DELETE <id> — hard delete of the claim row (the profile layer is the
 *        player's to erase); evidence links cascade away.
 */

import { correctClaim, deleteClaim } from '../../../companion-memory/src/store'
import type { ProfileCorrectionResponse } from '../../../companion-memory/src/types'
import { requireSession } from '../auth/require-session'
import { jsonResponse } from '../auth/respond'
import { parseJsonBody, type CompanionApiEnv } from './companion-shared'

const CORRECTION_MAX = 280

export async function handleClaimCorrection(
  request: Request,
  env: CompanionApiEnv,
  claimId: string
): Promise<Response> {
  const auth = await requireSession(env.AUTH, request)
  if (!auth.ok) return auth.response

  const body = await parseJsonBody(request)
  const correctionRaw = (body as { correction?: unknown } | null)?.correction
  const correction = typeof correctionRaw === 'string' ? correctionRaw.trim() : ''
  if (correction.length === 0 || correction.length > CORRECTION_MAX) {
    return jsonResponse({ error: `correction must be 1-${CORRECTION_MAX} characters` }, 422)
  }

  const newClaim = await correctClaim(env.COMPANION_DB, auth.session.user_id, claimId, correction)
  if (newClaim === null) {
    return jsonResponse({ error: 'claim not found' }, 404)
  }
  const responseBody: ProfileCorrectionResponse = {
    corrected_claim_id: claimId,
    new_claim: newClaim,
  }
  return jsonResponse(responseBody, 200)
}

export async function handleClaimDelete(
  request: Request,
  env: CompanionApiEnv,
  claimId: string
): Promise<Response> {
  const auth = await requireSession(env.AUTH, request)
  if (!auth.ok) return auth.response

  const deleted = await deleteClaim(env.COMPANION_DB, auth.session.user_id, claimId)
  if (!deleted) {
    return jsonResponse({ error: 'claim not found' }, 404)
  }
  return jsonResponse({ ok: true }, 200)
}
