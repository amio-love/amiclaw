/**
 * POST /api/companion/setup — the initial light customization data landing
 * (name + voice pick; L2 §Mechanism Variant 3).
 *
 * One companion per account: a second setup attempt is 409 — there is no
 * second-companion or companion-list path anywhere on the platform.
 * Personality is NOT configured here by design: the companion is shaped by
 * memories, not presets.
 */

import { isPlatformVoiceId } from '../../../companion-memory/src/types'
import type { CompanionSetupResponse } from '../../../companion-memory/src/types'
import { createCompanion } from '../../../companion-memory/src/store'
import { requireSession } from '../auth/require-session'
import { jsonResponse } from '../auth/respond'
import { parseJsonBody, wireVoicePosture, type CompanionApiEnv } from './companion-shared'

const NAME_MAX = 30
const ADDRESS_STYLE_MAX = 30

export async function handleCompanionSetup(
  request: Request,
  env: CompanionApiEnv
): Promise<Response> {
  const auth = await requireSession(env.AUTH, request)
  if (!auth.ok) return auth.response

  const body = await parseJsonBody(request)
  if (typeof body !== 'object' || body === null) {
    return jsonResponse({ error: 'invalid JSON body' }, 400)
  }
  const { name, voice_id, address_style } = body as {
    name?: unknown
    voice_id?: unknown
    address_style?: unknown
  }

  const trimmedName = typeof name === 'string' ? name.trim() : ''
  if (trimmedName.length === 0 || trimmedName.length > NAME_MAX) {
    return jsonResponse({ error: `name must be 1-${NAME_MAX} characters` }, 422)
  }
  if (!isPlatformVoiceId(voice_id)) {
    return jsonResponse({ error: 'unknown voice_id' }, 422)
  }
  const trimmedAddressStyle = typeof address_style === 'string' ? address_style.trim() : ''
  if (trimmedAddressStyle.length > ADDRESS_STYLE_MAX) {
    return jsonResponse(
      { error: `address_style must be at most ${ADDRESS_STYLE_MAX} characters` },
      422
    )
  }

  // Owner identity: the session, never the body.
  const companion = await createCompanion(env.COMPANION_DB, {
    userId: auth.session.user_id,
    name: trimmedName,
    voiceId: voice_id,
    addressStyle: trimmedAddressStyle,
  })
  if (companion === null) {
    return jsonResponse({ error: 'companion already exists' }, 409)
  }

  const responseBody: CompanionSetupResponse = {
    companion: {
      name: companion.name,
      address_style: companion.address_style,
      voice_id: companion.voice_id,
      profile_enabled: companion.profile_enabled === 1,
      voice_posture: wireVoicePosture(companion),
      created_at: companion.created_at,
    },
  }
  return jsonResponse(responseBody, 201)
}
