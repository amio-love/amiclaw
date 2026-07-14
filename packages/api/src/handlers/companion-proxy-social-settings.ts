/**
 * /api/companion/proxy-social — the author-side proxy-social master switch
 * (甲侧代言总开关). Mirrors the profile-switch control plane
 * (companion-profile.ts):
 *
 *   GET — the current switch state. `true` = the companion may autonomously
 *         leave proxy lines on other players' community events (the default).
 *   PUT — flip the switch. Off stops NEW proxy messages; already-published
 *         threads are untouched. Only the V1 authoring route reads this flag —
 *         the V2 reply route is a user-initiated tap and is never gated by it.
 *
 * Owner identity comes ONLY from the session (require-session guard) — never
 * from the request. The GET reads the value through `readProxySocialEnabled`,
 * the SAME explicit try/catch degrade seam the V1 guard uses, so the missing-
 * column → enabled contract holds identically on both read paths (migration-0008
 * lagging a deploy never turns the switch off); the derived-feed feature guards
 * share this philosophy. The PUT does NOT degrade — a write against a pre-0008
 * schema fails, relying on the migration-first-deploy order.
 */

import type { ProxySocialSettingsResponse } from '../../../companion-memory/src/types'
import {
  getCompanion,
  readProxySocialEnabled,
  setProxySocialEnabled,
} from '../../../companion-memory/src/store'
import { requireSession } from '../auth/require-session'
import { jsonResponse } from '../auth/respond'
import { parseJsonBody, type CompanionApiEnv } from './companion-shared'

export async function handleGetProxySocial(
  request: Request,
  env: CompanionApiEnv
): Promise<Response> {
  const auth = await requireSession(env.AUTH, request)
  if (!auth.ok) return auth.response

  // getCompanion gives the 404 semantics (no companion → no switch to read);
  // readProxySocialEnabled reads the VALUE through the degrade seam (missing
  // column → enabled), so GET and the V1 guard share one degrade contract.
  const companion = await getCompanion(env.COMPANION_DB, auth.session.user_id)
  if (companion === null) {
    return jsonResponse({ error: 'no companion set up' }, 404)
  }
  const body: ProxySocialSettingsResponse = {
    proxy_social_enabled: await readProxySocialEnabled(env.COMPANION_DB, auth.session.user_id),
  }
  return jsonResponse(body, 200, { 'Cache-Control': 'no-store' })
}

export async function handlePutProxySocial(
  request: Request,
  env: CompanionApiEnv
): Promise<Response> {
  const auth = await requireSession(env.AUTH, request)
  if (!auth.ok) return auth.response

  const body = await parseJsonBody(request)
  const proxySocialEnabled = (body as { proxy_social_enabled?: unknown } | null)
    ?.proxy_social_enabled
  if (typeof proxySocialEnabled !== 'boolean') {
    return jsonResponse({ error: 'proxy_social_enabled must be a boolean' }, 422)
  }

  const updated = await setProxySocialEnabled(
    env.COMPANION_DB,
    auth.session.user_id,
    proxySocialEnabled
  )
  if (!updated) {
    return jsonResponse({ error: 'no companion set up' }, 404)
  }
  const responseBody: ProxySocialSettingsResponse = { proxy_social_enabled: proxySocialEnabled }
  return jsonResponse(responseBody, 200)
}
