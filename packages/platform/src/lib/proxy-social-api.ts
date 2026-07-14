/**
 * Companion proxy social — the platform SPA's typed client for the two bounded
 * generation routes on the Platform AI Worker (L2 arch-component-proxy-social
 * §Interface). Both are strictly same-origin `/ai-intent/*` routes — called with
 * RELATIVE paths (never `API_BASE`): the Worker's origin check rejects any
 * cross-origin POST, and the routes only exist on the canonical zone, so a
 * preview host simply 404s (best-effort no-op) instead of tripping the origin
 * guard. Both ride the session cookie (`credentials: 'include'`) so the author (甲)
 * / responder (乙) identity is derived server-side — the client never sends an
 * owner id and never sends free text.
 *
 *  - `triggerCompanionProxyMessage` (V1): a background, best-effort trigger fired
 *    once per lobby session. Every server outcome except a real `messaged:true`
 *    (no companion / no public profile / no candidate / daily cap / decline /
 *    401 / 429 / 5xx) collapses to `none` — a background trigger is silent, so
 *    the caller shows nothing on any non-message outcome.
 *  - `sendCompanionProxyReply` (V2): a user-initiated action, so every refusal is
 *    mapped to an explicit discriminated result the UI turns into quiet inline
 *    feedback (409 reasons / 410 out-of-window / 429 / 401 / 403 / 404 / 502).
 *
 * Mirrors the `arcade-profile/api-client` result-shape convention: every call
 * returns a discriminated union and never throws at the call site.
 */

import type { ArcadeCommunityFeedTemplate } from '@amiclaw/arcade-profile/types'

const JSON_HEADERS = { 'Content-Type': 'application/json' }

const PROXY_MESSAGE_PATH = '/ai-intent/companion-proxy-message'
const PROXY_REPLY_PATH = '/ai-intent/companion-proxy-reply'

/** The target-event facts V1 returns for rendering the 甲-side transparency
    line — no second feed read needed (spec §Mechanism V1 / Variant 3). The
    `event_id` (`e`+16hex, the community feed card key) lets the 查看 link anchor
    at the exact event. */
export interface ProxyMessageTargetEvent {
  event_id: string
  template: ArcadeCommunityFeedTemplate
  target_public_label: string
  streak_days?: number
  duration_ms?: number
}

export type CompanionProxyMessageResult =
  /** The companion authored a public line; render the transparency dock line. */
  | { kind: 'messaged'; messageId: string; targetEvent: ProxyMessageTargetEvent }
  /** Any silent background outcome (`messaged:false`, 401, 429, 5xx, network). */
  | { kind: 'none' }

interface RawProxyMessageResponse {
  messaged: boolean
  message_id?: string
  target_event?: ProxyMessageTargetEvent
}

/**
 * Fire the V1 background trigger. Best-effort: any non-`messaged:true` outcome
 * (including a refusal status or a network error) resolves to `none`, so a
 * background trigger never surfaces an error to 甲.
 */
export async function triggerCompanionProxyMessage(): Promise<CompanionProxyMessageResult> {
  try {
    const res = await fetch(PROXY_MESSAGE_PATH, {
      method: 'POST',
      headers: JSON_HEADERS,
      credentials: 'include',
      body: '{}',
    })
    if (!res.ok) return { kind: 'none' }
    const data = (await res.json()) as RawProxyMessageResponse
    if (!data.messaged || !data.message_id || !data.target_event) return { kind: 'none' }
    return { kind: 'messaged', messageId: data.message_id, targetEvent: data.target_event }
  } catch {
    return { kind: 'none' }
  }
}

/**
 * V2 result. `ok` carries no reply body — the server response only echoes the
 * write-time signature, so the caller refetches the feed to render the freshly
 * written reply verbatim (never fabricated client-side). `already-replied` /
 * `out-of-window` also warrant a refetch (they reflect server truth the client
 * is now stale on); the remaining kinds map to quiet inline feedback.
 */
export type CompanionProxyReplyResult =
  | { kind: 'ok' }
  | { kind: 'already-replied' }
  | { kind: 'no-companion' }
  | { kind: 'no-public-profile' }
  | { kind: 'out-of-window' }
  | { kind: 'rate-limited' }
  | { kind: 'not-owner' }
  | { kind: 'not-found' }
  | { kind: 'anon' }
  | { kind: 'error' }

/**
 * Send the V2 reply for one proxy message. The body carries only the opaque
 * `message_id`; the responder identity is the server-side session (L2
 * invariant). 409 is split on the `reason` field into the three distinct states.
 */
export async function sendCompanionProxyReply(
  messageId: string
): Promise<CompanionProxyReplyResult> {
  try {
    const res = await fetch(PROXY_REPLY_PATH, {
      method: 'POST',
      headers: JSON_HEADERS,
      credentials: 'include',
      body: JSON.stringify({ message_id: messageId }),
    })
    if (res.ok) return { kind: 'ok' }
    if (res.status === 401) return { kind: 'anon' }
    if (res.status === 403) return { kind: 'not-owner' }
    if (res.status === 404) return { kind: 'not-found' }
    if (res.status === 409) {
      const data = (await res.json().catch(() => ({}))) as { reason?: string }
      if (data.reason === 'no-companion') return { kind: 'no-companion' }
      if (data.reason === 'no-public-profile') return { kind: 'no-public-profile' }
      return { kind: 'already-replied' }
    }
    if (res.status === 410) return { kind: 'out-of-window' }
    if (res.status === 429) return { kind: 'rate-limited' }
    return { kind: 'error' }
  } catch {
    return { kind: 'error' }
  }
}
