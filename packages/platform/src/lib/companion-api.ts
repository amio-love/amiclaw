/**
 * Companion data-access layer — the platform SPA's typed client for the
 * `/api/companion/*` control plane. Mirrors the `shared/leaderboard-api.ts`
 * pattern: every call returns a discriminated result so the UI distinguishes a
 * server refusal (401 / 404 / 409 / 422) from a network failure, and never
 * throws at the call site.
 *
 * Every request is `credentials: 'include'` so the session cookie rides along —
 * the owner `user_id` is derived server-side from that session; the client
 * never sends an owner id (L2 invariant).
 *
 * Dev seed: when `companionSeedEnabled()` is true (the `?companionSeed=1`
 * preview opt-in) every read short-circuits to representative mock data and
 * every mutation becomes a local no-op success — nothing reaches the backend
 * (READ-ONLY). This is how the album / profile surfaces are felt in a preview
 * before the real capture pipeline lands; production (no seed param) talks to
 * the real API and renders honest empty states.
 */

import { API_BASE } from '@shared/api-base'
import type {
  CompanionIdentity,
  CompanionResponse,
  CompanionSettingsBody,
  CompanionSetupBody,
  CompanionSetupResponse,
  MemoriesResponse,
  MemoryView,
  ProfileClaimView,
  ProfileCorrectionResponse,
  ProfileResponse,
  VoicePosture,
} from '@shared/companion-types'
import {
  companionSeedEnabled,
  SEED_COMPANION,
  seedClaims,
  seedMemories,
  seedCompanionStats,
  type CompanionStats,
} from './companion-seed'

export type { CompanionStats } from './companion-seed'

const BASE = `${API_BASE}/api/companion`
const JSON_HEADERS = { 'Content-Type': 'application/json' }

/**
 * Real-mode companionship counters. There is NO per-user game-stats source yet
 * — the leaderboard `user_id` migration and the capture pipeline are both
 * downstream — so the honest current count IS zero. These are genuine 0s, never
 * fabricated non-zero numbers; swap in the real read once that data lands.
 */
const REAL_STATS_PLACEHOLDER: CompanionStats = { games_completed: 0, successes: 0 }

/** Pull a server-supplied `{ error }` string off a non-ok response, if any. */
async function readError(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { error?: unknown }
    return typeof body.error === 'string' ? body.error : undefined
  } catch {
    return undefined
  }
}

// --- Identity read -----------------------------------------------------------

export type CompanionReadResult =
  | { kind: 'exists'; companion: CompanionIdentity; stats: CompanionStats }
  | { kind: 'none' }
  | { kind: 'error' }

export async function fetchCompanion(): Promise<CompanionReadResult> {
  // `stats` is ALWAYS present: illustrative counters in seed mode, honest zeros
  // in real mode (no per-user game-stats source yet). The card shows all three.
  if (companionSeedEnabled()) {
    return { kind: 'exists', companion: SEED_COMPANION, stats: seedCompanionStats() }
  }
  try {
    const res = await fetch(BASE, { credentials: 'include' })
    if (res.status === 404) return { kind: 'none' }
    if (!res.ok) return { kind: 'error' }
    const companion = (await res.json()) as CompanionResponse
    return { kind: 'exists', companion, stats: REAL_STATS_PLACEHOLDER }
  } catch {
    return { kind: 'error' }
  }
}

// --- Setup -------------------------------------------------------------------

export type SetupResult =
  | { kind: 'created'; companion: CompanionIdentity }
  | { kind: 'conflict' }
  | { kind: 'invalid'; error?: string }
  | { kind: 'error' }

export async function setupCompanion(body: CompanionSetupBody): Promise<SetupResult> {
  if (companionSeedEnabled()) {
    return {
      kind: 'created',
      companion: {
        ...SEED_COMPANION,
        name: body.name,
        voice_id: body.voice_id,
        address_style: body.address_style ?? '',
      },
    }
  }
  try {
    const res = await fetch(`${BASE}/setup`, {
      method: 'POST',
      headers: JSON_HEADERS,
      credentials: 'include',
      body: JSON.stringify(body),
    })
    if (res.status === 201) {
      const data = (await res.json()) as CompanionSetupResponse
      return { kind: 'created', companion: data.companion }
    }
    if (res.status === 409) return { kind: 'conflict' }
    if (res.status === 422) return { kind: 'invalid', error: await readError(res) }
    return { kind: 'error' }
  } catch {
    return { kind: 'error' }
  }
}

// --- Memory album ------------------------------------------------------------

export type MemoriesResult =
  | { kind: 'ok'; memories: MemoryView[]; nextCursor?: string }
  | { kind: 'error' }

export async function fetchMemories(cursor?: string): Promise<MemoriesResult> {
  if (companionSeedEnabled()) return { kind: 'ok', memories: seedMemories() }
  try {
    const params = new URLSearchParams()
    if (cursor) params.set('cursor', cursor)
    const query = params.toString()
    const res = await fetch(`${BASE}/memories${query ? `?${query}` : ''}`, {
      credentials: 'include',
    })
    if (!res.ok) return { kind: 'error' }
    const data = (await res.json()) as MemoriesResponse
    return {
      kind: 'ok',
      memories: data.memories,
      ...(data.next_cursor !== undefined ? { nextCursor: data.next_cursor } : {}),
    }
  } catch {
    return { kind: 'error' }
  }
}

export type MutationResult = { kind: 'ok' } | { kind: 'error' }

export async function deleteMemory(episodeId: string): Promise<MutationResult> {
  if (companionSeedEnabled()) return { kind: 'ok' }
  try {
    const res = await fetch(`${BASE}/memories/${encodeURIComponent(episodeId)}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    return res.ok ? { kind: 'ok' } : { kind: 'error' }
  } catch {
    return { kind: 'error' }
  }
}

// --- Profile control plane ---------------------------------------------------

export type ProfileResult =
  | { kind: 'ok'; profileEnabled: boolean; claims: ProfileClaimView[] }
  | { kind: 'none' }
  | { kind: 'error' }

export async function fetchProfile(): Promise<ProfileResult> {
  if (companionSeedEnabled()) {
    return { kind: 'ok', profileEnabled: SEED_COMPANION.profile_enabled, claims: seedClaims() }
  }
  try {
    const res = await fetch(`${BASE}/profile`, { credentials: 'include' })
    if (res.status === 404) return { kind: 'none' }
    if (!res.ok) return { kind: 'error' }
    const data = (await res.json()) as ProfileResponse
    return { kind: 'ok', profileEnabled: data.profile_enabled, claims: data.claims }
  } catch {
    return { kind: 'error' }
  }
}

export type CorrectionResult =
  | { kind: 'ok'; newClaim: ProfileClaimView; correctedClaimId: string }
  | { kind: 'invalid'; error?: string }
  | { kind: 'error' }

/**
 * Submit a correction for one claim. Takes the whole original claim so the UI
 * can render the new claim immediately. In seed mode the new claim is
 * synthesized locally (same dimension + evidence, the correction text, a fresh
 * id); in real mode only `{ correction }` is sent — the server re-words the
 * understanding and returns the new claim with its inherited evidence.
 */
export async function correctClaim(
  claim: ProfileClaimView,
  correction: string
): Promise<CorrectionResult> {
  if (companionSeedEnabled()) {
    const newClaim: ProfileClaimView = {
      id: `seed-corrected-${claim.id}-${Date.now()}`,
      dimension: claim.dimension,
      claim: correction,
      status: 'active',
      updated_at: new Date().toISOString(),
      evidence: claim.evidence.map((e) => ({ ...e })),
    }
    return { kind: 'ok', newClaim, correctedClaimId: claim.id }
  }
  try {
    const res = await fetch(`${BASE}/profile/${encodeURIComponent(claim.id)}/correction`, {
      method: 'POST',
      headers: JSON_HEADERS,
      credentials: 'include',
      body: JSON.stringify({ correction }),
    })
    if (res.ok) {
      const data = (await res.json()) as ProfileCorrectionResponse
      return { kind: 'ok', newClaim: data.new_claim, correctedClaimId: data.corrected_claim_id }
    }
    if (res.status === 422) return { kind: 'invalid', error: await readError(res) }
    return { kind: 'error' }
  } catch {
    return { kind: 'error' }
  }
}

export async function deleteClaim(claimId: string): Promise<MutationResult> {
  if (companionSeedEnabled()) return { kind: 'ok' }
  try {
    const res = await fetch(`${BASE}/profile/${encodeURIComponent(claimId)}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    return res.ok ? { kind: 'ok' } : { kind: 'error' }
  } catch {
    return { kind: 'error' }
  }
}

export type DeleteAllResult = { kind: 'ok'; deleted: number } | { kind: 'error' }

export async function deleteAllClaims(): Promise<DeleteAllResult> {
  if (companionSeedEnabled()) return { kind: 'ok', deleted: seedClaims().length }
  try {
    const res = await fetch(`${BASE}/profile`, { method: 'DELETE', credentials: 'include' })
    if (!res.ok) return { kind: 'error' }
    const data = (await res.json()) as { deleted?: number }
    return { kind: 'ok', deleted: typeof data.deleted === 'number' ? data.deleted : 0 }
  } catch {
    return { kind: 'error' }
  }
}

export type ProfileToggleResult = { kind: 'ok'; profileEnabled: boolean } | { kind: 'error' }

export async function setProfileEnabled(enabled: boolean): Promise<ProfileToggleResult> {
  if (companionSeedEnabled()) return { kind: 'ok', profileEnabled: enabled }
  try {
    const res = await fetch(`${BASE}/profile`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      credentials: 'include',
      body: JSON.stringify({ profile_enabled: enabled }),
    })
    if (!res.ok) return { kind: 'error' }
    return { kind: 'ok', profileEnabled: enabled }
  } catch {
    return { kind: 'error' }
  }
}

// --- Presence settings (voice posture) ----------------------------------------

/**
 * Persist the remembered auto-voice posture (`PUT /api/companion/settings`).
 * Fire-and-forget from the dock's point of view: the localStorage cache is
 * written first (the client's fast path), this call syncs the account SSOT.
 */
export async function putVoicePosture(posture: VoicePosture): Promise<MutationResult> {
  if (companionSeedEnabled()) return { kind: 'ok' }
  try {
    const body: CompanionSettingsBody = { voice_posture: posture }
    const res = await fetch(`${BASE}/settings`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      credentials: 'include',
      body: JSON.stringify(body),
    })
    return res.ok ? { kind: 'ok' } : { kind: 'error' }
  } catch {
    return { kind: 'error' }
  }
}
