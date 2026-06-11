-- Migration 0001 — Companion Memory initial schema (the repo's first D1 database).
--
-- Five core entities from the L2 spec (arch-component-companion-memory) plus
-- the processed-event record table for the idempotent async write path:
--
--   companion              1:1 companion profile, keyed by user_id (PK).
--   episode                visible episodic memory ("memory album" rows).
--   profile_claim          implicit understanding-layer profile claims.
--   profile_claim_evidence claim <-> episode provenance (composite PK).
--   asset_entry            append-only account-level asset ledger.
--   capture_event          capture inbox + processed-event record (outbox
--                          direction): one row per stable capture event id,
--                          the idempotency gate for consolidation.
--
-- Cross-table invariants the DDL itself cannot express as foreign keys are
-- enforced by SQLite triggers below (same-user evidence linkage, episode
-- soft-delete cascade). D1 enforces foreign keys and supports triggers; the
-- unit tests run this exact file against real SQLite via `node:sqlite`.

CREATE TABLE companion (
  -- One companion per account: the user_id PRIMARY KEY *is* the 1:1 invariant.
  user_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  -- How the companion addresses the player. Empty string = default.
  address_style TEXT NOT NULL DEFAULT '',
  -- Platform-neutral voice id. Vendor voice params are resolved server-side
  -- from this id at session assembly (platform-ai voice-id-mapping, provider-
  -- config plane), never stored here — switching TTS vendors must not touch
  -- this table. Resolution is total: an unmapped/unfilled id degrades to the
  -- TTS provider's default voice at assembly, never failing the session.
  voice_id TEXT NOT NULL,
  -- Profile (understanding layer) switch. 0 = stop claim consolidation AND
  -- stop claim injection; episodes (visible memories) are unaffected.
  profile_enabled INTEGER NOT NULL DEFAULT 1 CHECK (profile_enabled IN (0, 1)),
  -- Bulk profile-delete watermark (ISO 8601, NULL = never bulk-deleted).
  -- Written atomically with the bulk claim delete; consolidation skips CLAIM
  -- production for capture events created at-or-before this instant, so a
  -- pending/retrying event can never resurrect a profile the player just
  -- erased. Episodes and asset entries are NOT gated (the player deleted the
  -- profile layer, not the memories or the ledger). Single-claim deletes and
  -- corrections do not touch it.
  profile_deleted_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE episode (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES companion (user_id),
  occurred_at TEXT NOT NULL,
  game_id TEXT NOT NULL,
  title TEXT NOT NULL,
  -- 1-3 sentence narrative from the companion's point of view.
  narrative TEXT NOT NULL,
  -- Provenance: which capture input produced this row.
  source_kind TEXT NOT NULL CHECK (source_kind IN ('session_summary', 'settlement')),
  source_ref TEXT NOT NULL,
  -- Source-derived unique key: `<capture event_id>#<ordinal>`. The idempotency
  -- anchor for the write path — replaying the same capture event re-derives
  -- the same key and the insert is ON CONFLICT DO NOTHING.
  source_key TEXT NOT NULL UNIQUE,
  -- Injection-ranking signal (0-100). Policy numbers live in injection-policy
  -- config, not here.
  salience INTEGER NOT NULL DEFAULT 50 CHECK (salience BETWEEN 0 AND 100),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
  created_at TEXT NOT NULL
);

CREATE INDEX idx_episode_user_status_occurred ON episode (user_id, status, occurred_at DESC);

CREATE TABLE profile_claim (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES companion (user_id),
  -- What the claim is about: play-style, pacing preference, sticking points,
  -- topic preference, ... Free-form dimension label.
  dimension TEXT NOT NULL,
  claim TEXT NOT NULL,
  -- 'active'    -> live, eligible for injection (iff >=1 active evidence).
  -- 'corrected' -> superseded by a player correction (kept as history).
  -- 'deleted'   -> auto-invalidated when its last active evidence episode was
  --                deleted (player hard-delete removes the row instead).
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'corrected', 'deleted')),
  -- Source-derived unique key (idempotent replay for consolidation-produced
  -- claims; `correction:<original id>` for player corrections).
  source_key TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_claim_user_status ON profile_claim (user_id, status);

CREATE TABLE profile_claim_evidence (
  profile_claim_id TEXT NOT NULL REFERENCES profile_claim (id) ON DELETE CASCADE,
  episode_id TEXT NOT NULL REFERENCES episode (id),
  created_at TEXT NOT NULL,
  -- Composite PK = the unique claim-episode pair: one evidence row per link.
  PRIMARY KEY (profile_claim_id, episode_id)
);

CREATE INDEX idx_evidence_episode ON profile_claim_evidence (episode_id);

CREATE TABLE asset_entry (
  id TEXT PRIMARY KEY,
  -- Account-level ownership: no product prefix in the key space and no FK to
  -- companion — assets belong to the account, not to one product's profile.
  user_id TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  -- Provenance only — never a usage restriction.
  source_product TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  -- Source-derived unique key (`<capture event_id>#asset#<ordinal>`): replaying
  -- the same settlement event must never double-credit the ledger.
  source_key TEXT NOT NULL UNIQUE,
  earned_at TEXT NOT NULL
);

CREATE INDEX idx_asset_user ON asset_entry (user_id, earned_at DESC);

CREATE TABLE capture_event (
  -- Stable, source-derived event id (`session-summary:<sessionId>` /
  -- `settlement:<settlementId>`). PRIMARY KEY = the processed-event record:
  -- re-capturing the same source is ON CONFLICT DO NOTHING.
  event_id TEXT PRIMARY KEY,
  -- No FK to companion: an event may arrive for a user with no companion yet;
  -- consolidation discards it (memory exists only behind mode② setup).
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('session_summary', 'settlement')),
  game_id TEXT NOT NULL,
  -- Join key linking a session summary with the same run's settlement event.
  -- NULL = no join key; the two inputs consolidate independently.
  game_run_id TEXT,
  -- Raw capture payload, JSON.
  payload TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'discarded')),
  -- Failed consolidation attempts so far; once the retry budget is exhausted
  -- the event is marked processed WITH NO OUTPUT (it never retries forever).
  -- Settlement facts are not lost to that degradation — they consolidate from
  -- their own settlement event, deterministically and without the LLM.
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  processed_at TEXT
);

CREATE INDEX idx_capture_status ON capture_event (status, created_at);

-- --- Same-user cross-table invariant -----------------------------------------
-- A foreign key cannot express "the claim's user_id equals the episode's
-- user_id"; these triggers enforce it on the write path for both INSERT and
-- UPDATE of an evidence row.

CREATE TRIGGER trg_evidence_same_user_insert
BEFORE INSERT ON profile_claim_evidence
WHEN (SELECT user_id FROM profile_claim WHERE id = NEW.profile_claim_id)
  IS NOT (SELECT user_id FROM episode WHERE id = NEW.episode_id)
BEGIN
  SELECT RAISE(ABORT, 'profile_claim_evidence: claim and episode must belong to the same user');
END;

CREATE TRIGGER trg_evidence_same_user_update
BEFORE UPDATE ON profile_claim_evidence
WHEN (SELECT user_id FROM profile_claim WHERE id = NEW.profile_claim_id)
  IS NOT (SELECT user_id FROM episode WHERE id = NEW.episode_id)
BEGIN
  SELECT RAISE(ABORT, 'profile_claim_evidence: claim and episode must belong to the same user');
END;

-- --- Episode soft-delete cascade ----------------------------------------------
-- Deleting an episode invalidates every claim whose ACTIVE evidence drops to
-- zero: such a claim leaves 'active' (status -> 'deleted') and therefore can
-- never be injected. Claims that still hold at least one other active
-- evidence episode are untouched. Read paths additionally require >=1 active
-- evidence (belt and braces), so a claim can never surface on trigger bypass.

CREATE TRIGGER trg_episode_delete_invalidates_claims
AFTER UPDATE OF status ON episode
WHEN NEW.status = 'deleted' AND OLD.status = 'active'
BEGIN
  UPDATE profile_claim
  SET status = 'deleted',
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE status = 'active'
    AND id IN (SELECT profile_claim_id FROM profile_claim_evidence WHERE episode_id = NEW.id)
    AND NOT EXISTS (
      SELECT 1
      FROM profile_claim_evidence pce
      JOIN episode e ON e.id = pce.episode_id
      WHERE pce.profile_claim_id = profile_claim.id
        AND e.status = 'active'
    );
END;
