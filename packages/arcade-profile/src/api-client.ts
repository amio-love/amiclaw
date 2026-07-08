import type {
  ArcadeCommunityFeedResponse,
  ArcadeCommunityLikeResponse,
  ArcadeProfileClaimBody,
  ArcadeProfileClaimResponse,
  ArcadeProfileEvent,
  ArcadeProfileResponse,
  ArcadeStreakLeaderboardResponse,
} from './types'

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const DEFAULT_API_BASE = 'https://claw.amio.fans'

function apiBase(): string {
  const meta = import.meta as ImportMeta & { env?: { VITE_API_BASE?: string } }
  return meta.env?.VITE_API_BASE ?? DEFAULT_API_BASE
}

function publicProfileOf(data: ArcadeProfileResponse): ArcadeProfileResponse['public_profile'] {
  return data.public_profile ?? { claimed: false, public_label: null }
}

export type ArcadeProfileReadResult =
  | {
      kind: 'ok'
      profile: ArcadeProfileResponse['profile']
      publicProfile: ArcadeProfileResponse['public_profile']
    }
  | { kind: 'anon' }
  | { kind: 'error' }

export type ArcadeProfileMutationResult =
  | {
      kind: 'ok'
      profile: ArcadeProfileResponse['profile']
      publicProfile: ArcadeProfileResponse['public_profile']
      sourceKeys?: string[]
    }
  | { kind: 'anon' }
  | { kind: 'invalid' }
  | { kind: 'error' }

export type ArcadeStreakLeaderboardReadResult =
  | { kind: 'ok'; board: ArcadeStreakLeaderboardResponse }
  | { kind: 'error' }

export async function fetchArcadeProfile(): Promise<ArcadeProfileReadResult> {
  try {
    const res = await fetch(`${apiBase()}/api/arcade/profile`, { credentials: 'include' })
    if (res.status === 401) return { kind: 'anon' }
    if (!res.ok) return { kind: 'error' }
    const data = (await res.json()) as ArcadeProfileResponse
    return { kind: 'ok', profile: data.profile, publicProfile: publicProfileOf(data) }
  } catch {
    return { kind: 'error' }
  }
}

export async function submitArcadeProfileEvent(
  event: ArcadeProfileEvent
): Promise<ArcadeProfileMutationResult> {
  try {
    const res = await fetch(`${apiBase()}/api/arcade/profile/events`, {
      method: 'POST',
      headers: JSON_HEADERS,
      credentials: 'include',
      body: JSON.stringify(event),
    })
    // 204 = anonymous best-effort sync (the server accepted the fire-and-forget
    // event but has no account to attach it to — audit F27); 401 kept for
    // defensiveness. Both resolve to `anon` so the caller keeps its local record
    // without treating it as an error.
    if (res.status === 204 || res.status === 401) return { kind: 'anon' }
    if (res.status === 422 || res.status === 400) return { kind: 'invalid' }
    if (!res.ok) return { kind: 'error' }
    const data = (await res.json()) as ArcadeProfileResponse
    return { kind: 'ok', profile: data.profile, publicProfile: publicProfileOf(data) }
  } catch {
    return { kind: 'error' }
  }
}

export async function claimArcadeProfile(
  body: ArcadeProfileClaimBody
): Promise<ArcadeProfileMutationResult> {
  try {
    const res = await fetch(`${apiBase()}/api/arcade/profile/claim`, {
      method: 'POST',
      headers: JSON_HEADERS,
      credentials: 'include',
      body: JSON.stringify(body),
    })
    if (res.status === 401) return { kind: 'anon' }
    if (res.status === 422 || res.status === 400) return { kind: 'invalid' }
    if (!res.ok) return { kind: 'error' }
    const data = (await res.json()) as ArcadeProfileClaimResponse
    return {
      kind: 'ok',
      profile: data.profile,
      publicProfile: publicProfileOf(data),
      sourceKeys: data.source_keys,
    }
  } catch {
    return { kind: 'error' }
  }
}

export async function fetchArcadeStreakLeaderboard(
  options: { date?: string; limit?: number } = {}
): Promise<ArcadeStreakLeaderboardReadResult> {
  const params = new URLSearchParams()
  if (options.date) params.set('date', options.date)
  if (options.limit !== undefined) params.set('limit', String(options.limit))
  const query = params.toString()
  try {
    const res = await fetch(`${apiBase()}/api/arcade/streaks${query ? `?${query}` : ''}`)
    if (!res.ok) return { kind: 'error' }
    const data = (await res.json()) as ArcadeStreakLeaderboardResponse
    return { kind: 'ok', board: data }
  } catch {
    return { kind: 'error' }
  }
}

export type ArcadeCommunityFeedReadResult =
  | { kind: 'ok'; feed: ArcadeCommunityFeedResponse }
  | { kind: 'error' }

/** Read the community feed. Anonymous is legal (the feed is public); a signed-in
    read additionally carries the cookie so the viewer's own likes are marked. */
export async function fetchArcadeCommunityFeed(
  options: { before?: string; limit?: number } = {}
): Promise<ArcadeCommunityFeedReadResult> {
  const params = new URLSearchParams()
  if (options.before) params.set('before', options.before)
  if (options.limit !== undefined) params.set('limit', String(options.limit))
  const query = params.toString()
  try {
    const res = await fetch(`${apiBase()}/api/arcade/community/feed${query ? `?${query}` : ''}`, {
      credentials: 'include',
    })
    if (!res.ok) return { kind: 'error' }
    const data = (await res.json()) as ArcadeCommunityFeedResponse
    return { kind: 'ok', feed: data }
  } catch {
    return { kind: 'error' }
  }
}

export type ArcadeCommunityLikeResult =
  | { kind: 'ok'; like: ArcadeCommunityLikeResponse }
  | { kind: 'anon' }
  | { kind: 'invalid' }
  | { kind: 'error' }

/** Like (POST) or unlike (DELETE) a feed event. Liking requires a session — an
    anonymous attempt resolves to `anon` so the UI can surface the login hint. */
export async function setArcadeCommunityLike(
  eventId: string,
  liked: boolean
): Promise<ArcadeCommunityLikeResult> {
  try {
    const res = await fetch(`${apiBase()}/api/arcade/community/likes`, {
      method: liked ? 'POST' : 'DELETE',
      headers: JSON_HEADERS,
      credentials: 'include',
      body: JSON.stringify({ event_id: eventId }),
    })
    if (res.status === 401) return { kind: 'anon' }
    if (res.status === 422 || res.status === 400) return { kind: 'invalid' }
    if (!res.ok) return { kind: 'error' }
    const data = (await res.json()) as ArcadeCommunityLikeResponse
    return { kind: 'ok', like: data }
  } catch {
    return { kind: 'error' }
  }
}
