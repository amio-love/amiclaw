/**
 * GET /api/companion/assets — the reward-economy balance + ledger read path
 * (L2 design §2). `asset_entry` is a companion-memory-owned table, so this joins
 * the `/api/companion/*` family: require-session guarded, owner `user_id`
 * derived EXCLUSIVELY from the session (never the request).
 *
 * On every authenticated read it first attempts the one-time +10 welcome grant
 * (idempotent `welcome:{userId}`; design §6) — so a user whose first economy
 * action is viewing their balance self-heals the grant — then returns the
 * current balance and a keyset page of recent ledger entries. `welcome_granted`
 * is set true ONLY on the request that actually mints the grant, driving a
 * one-time "+10 见面礼" UI beat; every later read omits it.
 *
 * The grant is fail-open: a D1 failure while minting never blocks the balance
 * read (welcome_granted just stays false). The row `id` is never exposed — it
 * lives only inside the opaque cursor (design §2, finding 7).
 */

import type { CompanionAssetsResponse } from '../../../../shared/companion-types'
import { ASSET_TYPE_STARBURST } from '../../../companion-memory/src/economy'
import {
  creditWelcomeGrant,
  listAssetEntries,
  readBalance,
} from '../../../companion-memory/src/ledger'
import { requireSession } from '../auth/require-session'
import { jsonResponse } from '../auth/respond'
import type { CompanionApiEnv } from './companion-shared'

export async function handleGetCompanionAssets(
  request: Request,
  env: CompanionApiEnv
): Promise<Response> {
  const auth = await requireSession(env.AUTH, request)
  if (!auth.ok) return auth.response

  const userId = auth.session.user_id

  // Welcome grant self-heals on the first balance view (idempotent, fail-open).
  // Mint BEFORE reading balance so a brand-new user's balance already shows +10.
  let welcomeGranted = false
  try {
    welcomeGranted = (await creditWelcomeGrant(env.COMPANION_DB, userId)).credited
  } catch {
    // Fail-open: a D1 failure while minting must never block the balance read.
  }

  const url = new URL(request.url)
  const limitRaw = url.searchParams.get('limit')
  const limit = limitRaw === null ? undefined : Number.parseInt(limitRaw, 10)
  const cursor = url.searchParams.get('cursor') ?? undefined

  const balance = await readBalance(env.COMPANION_DB, userId)
  const page = await listAssetEntries(env.COMPANION_DB, userId, {
    ...(limit !== undefined && Number.isFinite(limit) ? { limit } : {}),
    ...(cursor !== undefined ? { cursor } : {}),
  })

  const body: CompanionAssetsResponse = {
    asset_type: ASSET_TYPE_STARBURST,
    balance,
    entries: page.entries,
    ...(page.nextCursor !== undefined ? { next_cursor: page.nextCursor } : {}),
    ...(welcomeGranted ? { welcome_granted: true } : {}),
  }
  return jsonResponse(body, 200, { 'Cache-Control': 'no-store' })
}
