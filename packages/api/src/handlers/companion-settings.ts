/**
 * PUT /api/companion/settings — the presence-layer settings write
 * (companion-presence-design §姿态记忆模型).
 *
 * Persists the remembered auto-voice posture (`voice_posture`) on the 1:1
 * companion row so it syncs across devices; the client mirrors every write
 * into its localStorage cache for the pre-API read at page load. Owner
 * identity comes ONLY from the session (require-session guard) — never from
 * the request. The endpoint is deliberately narrow: one scalar today, shaped
 * so later presence preferences (勿扰时段, 主动性档位) land as additional
 * optional body fields on this same route without a new endpoint.
 */

import type { CompanionSettingsResponse } from '../../../companion-memory/src/types'
import { isVoicePosture } from '../../../companion-memory/src/types'
import { setVoicePosture } from '../../../companion-memory/src/store'
import { requireSession } from '../auth/require-session'
import { jsonResponse } from '../auth/respond'
import { parseJsonBody, type CompanionApiEnv } from './companion-shared'

export async function handlePutCompanionSettings(
  request: Request,
  env: CompanionApiEnv
): Promise<Response> {
  const auth = await requireSession(env.AUTH, request)
  if (!auth.ok) return auth.response

  const body = await parseJsonBody(request)
  const posture = (body as { voice_posture?: unknown } | null)?.voice_posture
  if (!isVoicePosture(posture)) {
    return jsonResponse(
      { error: 'voice_posture must be voice-default | quiet-remembered | denied-remembered' },
      422
    )
  }

  const updated = await setVoicePosture(env.COMPANION_DB, auth.session.user_id, posture)
  if (!updated) {
    return jsonResponse({ error: 'no companion set up' }, 404)
  }
  const responseBody: CompanionSettingsResponse = { voice_posture: posture }
  return jsonResponse(responseBody, 200)
}
