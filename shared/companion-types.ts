/**
 * Cross-container wire shapes for the Companion Memory component (mode② path).
 *
 * SSOT for the companion wire contract: the platform-neutral voice catalog and
 * every JSON shape that crosses the `/api/companion/*` HTTP boundary — the
 * setup body/response, the identity read, the profile claims + evidence views,
 * the memory-album page, and the four control-plane mutation bodies.
 *
 * Lives in `shared/` alongside `auth-types.ts` so ONE definition is consumed by
 * both the Workers handlers (`packages/api`, via `packages/companion-memory`
 * re-exports) and the frontend (`packages/platform`). The domain package keeps
 * its D1 *record* types local (`packages/companion-memory/src/types.ts`); only
 * the wire shapes live here.
 *
 * Two load-bearing constraints encoded here:
 *
 *  1. No wire shape ever carries an OWNER `user_id` inbound. The control-plane
 *     owner is derived exclusively from the server-side session
 *     (require-session guard); request bodies that include a `user_id` are
 *     ignored by construction — the parsed body types simply have no such
 *     field.
 *  2. `voice_id` is platform-neutral. The catalog below is the platform's own
 *     id space; vendor voice params are a server-side mapping at the
 *     provider-config plane, so switching TTS vendors never touches companion
 *     data.
 *
 * Architecture SSOT: arch-component-companion-memory.
 *
 * Keep this file dependency-free (pure types + a const array + a type guard) —
 * it is consumed by the Workers typecheck, which excludes the browser-only
 * `shared/` files.
 */

// --- Platform-neutral voice catalog -----------------------------------------

/**
 * The platform's own voice id space. Companion rows store one of these ids;
 * the vendor mapping (platform-ai side) must cover every entry. Adding a
 * voice = adding an id here + a vendor mapping there.
 */
export const PLATFORM_VOICE_IDS = ['companion-warm', 'companion-bright', 'companion-calm'] as const

export type PlatformVoiceId = (typeof PLATFORM_VOICE_IDS)[number]

export function isPlatformVoiceId(value: unknown): value is PlatformVoiceId {
  return typeof value === 'string' && (PLATFORM_VOICE_IDS as readonly string[]).includes(value)
}

// --- Companion identity (Variant 3 read path) --------------------------------

/**
 * The companion's player-visible identity fields. Shared by the setup response
 * and the `GET /api/companion` read — both surface the same five fields, so the
 * shape is defined once.
 */
export interface CompanionIdentity {
  name: string
  address_style: string
  voice_id: string
  profile_enabled: boolean
  created_at: string
}

/**
 * Body of `GET /api/companion` — the identity read the UI uses to decide
 * setup-vs-already-created and to render "你的伙伴 X". 404 when no companion
 * exists (mapped client-side to the onboarding flow). Read-only: there is no
 * rename / re-voice path (setup is one-time, continuity over everything).
 */
export type CompanionResponse = CompanionIdentity

// --- Setup (Variant 3 write path) --------------------------------------------

/** Body of `POST /api/companion/setup`. Owner user_id comes from the session. */
export interface CompanionSetupBody {
  name: string
  voice_id: string
  address_style?: string
}

export interface CompanionSetupResponse {
  companion: CompanionIdentity
}

// --- Profile claims + evidence (Variant 4 read path) -------------------------

export type ProfileClaimStatus = 'active' | 'corrected' | 'deleted'

/** One evidence link in a profile-claim view. */
export interface ProfileClaimEvidenceView {
  episode_id: string
  title: string
  occurred_at: string
  game_id: string
}

/** One claim + its evidence chain, as returned by `GET /api/companion/profile`. */
export interface ProfileClaimView {
  id: string
  dimension: string
  claim: string
  status: ProfileClaimStatus
  updated_at: string
  evidence: ProfileClaimEvidenceView[]
}

export interface ProfileResponse {
  profile_enabled: boolean
  claims: ProfileClaimView[]
}

/** Body of `PUT /api/companion/profile` (the profile switch). */
export interface ProfileSettingsBody {
  profile_enabled: boolean
}

/** Body of `POST /api/companion/profile/<id>/correction`. */
export interface ProfileCorrectionBody {
  correction: string
}

export interface ProfileCorrectionResponse {
  corrected_claim_id: string
  new_claim: ProfileClaimView
}

// --- Memory album (episodic layer read path) ---------------------------------

/** One memory-album row, as returned by `GET /api/companion/memories`. */
export interface MemoryView {
  id: string
  occurred_at: string
  game_id: string
  title: string
  narrative: string
}

export interface MemoriesResponse {
  memories: MemoryView[]
  /** Opaque keyset cursor for the next page; absent on the last page. */
  next_cursor?: string
}
