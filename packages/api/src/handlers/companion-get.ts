/**
 * GET /api/companion — the companion identity read path (L2 §Mechanism Variant
 * 3, "伙伴身份读端点").
 *
 * Returns the current account's companion identity
 * (`name` / `address_style` / `voice_id` / `profile_enabled` / `created_at`),
 * or 404 when no companion has been set up. The UI uses this to decide
 * setup-vs-already-created and to render "你的伙伴 X".
 *
 * Read-only by design: this endpoint does NOT rename or re-voice (setup is
 * one-time; continuity over everything). Owner identity comes ONLY from the
 * session (require-session guard) — never from the request.
 */

import type { CompanionResponse } from '../../../companion-memory/src/types'
import { getCompanion } from '../../../companion-memory/src/store'
import { requireSession } from '../auth/require-session'
import { jsonResponse } from '../auth/respond'
import { wireVoicePosture, type CompanionApiEnv } from './companion-shared'

export async function handleGetCompanion(
  request: Request,
  env: CompanionApiEnv
): Promise<Response> {
  const auth = await requireSession(env.AUTH, request)
  if (!auth.ok) return auth.response

  const companion = await getCompanion(env.COMPANION_DB, auth.session.user_id)
  if (companion === null) {
    return jsonResponse({ error: 'no companion set up' }, 404, { 'Cache-Control': 'no-store' })
  }

  const body: CompanionResponse = {
    name: companion.name,
    address_style: companion.address_style,
    voice_id: companion.voice_id,
    profile_enabled: companion.profile_enabled === 1,
    voice_posture: wireVoicePosture(companion),
    created_at: companion.created_at,
  }
  return jsonResponse(body, 200, { 'Cache-Control': 'no-store' })
}
