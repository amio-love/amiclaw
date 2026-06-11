/**
 * Companion Memory — entity records, capture inputs, and cross-container wire
 * shapes.
 *
 * This is the type-shape SSOT for the companion-memory domain (L2:
 * arch-component-companion-memory). The wire shapes follow the `shared/`
 * convention (`shared/auth-types.ts`): snake_case JSON fields on the HTTP
 * boundary, one definition consumed by both the Workers handlers and any
 * future frontend.
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
 *     provider-config plane (packages/platform-ai/src/voice-id-mapping.ts),
 *     so switching TTS vendors never touches companion data.
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

// --- Entity records (D1 row shapes) ------------------------------------------

export interface CompanionRecord {
  user_id: string
  name: string
  address_style: string
  voice_id: string
  /** SQLite boolean: 0 | 1. */
  profile_enabled: number
  created_at: string
}

export type EpisodeStatus = 'active' | 'deleted'

export interface EpisodeRecord {
  id: string
  user_id: string
  occurred_at: string
  game_id: string
  title: string
  narrative: string
  source_kind: 'session_summary' | 'settlement'
  source_ref: string
  source_key: string
  salience: number
  status: EpisodeStatus
  created_at: string
}

export type ProfileClaimStatus = 'active' | 'corrected' | 'deleted'

export interface ProfileClaimRecord {
  id: string
  user_id: string
  dimension: string
  claim: string
  status: ProfileClaimStatus
  source_key: string | null
  created_at: string
  updated_at: string
}

export interface AssetEntryRecord {
  id: string
  user_id: string
  asset_type: string
  amount: number
  source_product: string
  source_ref: string
  source_key: string
  earned_at: string
}

export type CaptureEventStatus = 'pending' | 'processed' | 'discarded'

export interface CaptureEventRecord {
  event_id: string
  user_id: string
  kind: 'session_summary' | 'settlement'
  game_id: string
  game_run_id: string | null
  payload: string
  occurred_at: string
  status: CaptureEventStatus
  attempts: number
  created_at: string
  processed_at: string | null
}

// --- Capture inputs (write-path raw material) --------------------------------

/**
 * Session-summary capture input — the shape the platform-ai `endSession`
 * boundary hands to the capture entry. Mirrors the additive `SessionSummary`
 * fields (highlights / gameRunId / occurredAt); missing-field degradation:
 * no `userId` -> dropped, no highlights -> settlement facts only, no
 * `gameRunId` -> consolidates independently of settlement events.
 */
export interface SessionSummaryCaptureInput {
  sessionId: string
  gameId: string
  userId: string
  turnCount: number
  highlights?: string[]
  gameRunId?: string
  occurredAt?: string
}

/** One asset grant carried by a settlement event. */
export interface SettlementAssetInput {
  assetType: string
  amount: number
}

/**
 * Game settlement capture input — submitted server-side for signed-in players
 * (Edge Functions path; wiring is the downstream wire task). `settlementId`
 * must be a stable, caller-derived id for the settled run (e.g. the game run
 * id) — it anchors the idempotent event id.
 */
export interface SettlementCaptureInput {
  settlementId: string
  userId: string
  gameId: string
  gameRunId?: string
  outcome: 'win' | 'loss' | 'timeout'
  durationSeconds?: number
  occurredAt?: string
  assets?: SettlementAssetInput[]
}

// --- Companion context (assembly-time injection) ------------------------------

/** One injected profile claim. */
export interface CompanionContextClaim {
  dimension: string
  claim: string
}

/** One injected episode. */
export interface CompanionContextEpisode {
  title: string
  narrative: string
  occurred_at: string
  game_id: string
}

/**
 * Resolver output: the deterministic injection payload for one session
 * assembly. `null` from the resolver means "no companion set up" — the
 * session proceeds memory-less. Empty `claims` / `episodes` with a present
 * companion is the "no memories yet" degradation: the companion identity is
 * still injected.
 */
export interface CompanionContext {
  companion: {
    name: string
    address_style: string
    voice_id: string
  }
  claims: CompanionContextClaim[]
  episodes: CompanionContextEpisode[]
}

// --- Control-plane wire shapes (/api/companion/*) -----------------------------

/** Body of `POST /api/companion/setup`. Owner user_id comes from the session. */
export interface CompanionSetupBody {
  name: string
  voice_id: string
  address_style?: string
}

export interface CompanionSetupResponse {
  companion: {
    name: string
    address_style: string
    voice_id: string
    profile_enabled: boolean
    created_at: string
  }
}

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
