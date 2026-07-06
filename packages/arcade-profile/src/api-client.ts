import type {
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
    if (res.status === 401) return { kind: 'anon' }
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
