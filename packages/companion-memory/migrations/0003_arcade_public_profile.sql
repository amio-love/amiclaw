-- Migration 0003 — Arcade public streak profile metadata.
--
-- Public streak-board eligibility is explicit metadata. Streak counters remain
-- derived from arcade-profile event tables; this migration only adds read
-- indexes and the public label table.

CREATE INDEX idx_arcade_bombsquad_user_daily_streak
  ON arcade_profile_bombsquad_run (user_id, mode, outcome, finished_at DESC);

CREATE INDEX idx_arcade_oracle_user_sign_date
  ON arcade_profile_oracle_sign (user_id, sign_date DESC, created_at DESC);

CREATE TABLE arcade_public_profile (
  user_id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  public_label TEXT NOT NULL CHECK (length(public_label) >= 1 AND length(public_label) <= 28),
  claimed_at TEXT NOT NULL,
  label_updated_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_arcade_public_profile_label
  ON arcade_public_profile (public_label);
