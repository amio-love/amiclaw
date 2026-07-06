-- Migration 0002 — Arcade profile account data.
--
-- This D1 database was first introduced for Companion Memory, but the
-- physical database is now also the account data plane for small account-owned
-- Arcade records. These tables are owned by the arcade-profile domain package,
-- not by the Companion Memory model. They intentionally carry no foreign keys
-- to `companion`: a player can have an account profile before creating an AI
-- companion.

CREATE TABLE arcade_profile_bombsquad_run (
  user_id TEXT NOT NULL,
  source_key TEXT NOT NULL,
  profile_id TEXT,
  run_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('daily', 'practice')),
  outcome TEXT NOT NULL CHECK (
    outcome IN ('defused', 'exploded', 'practice-cleared', 'practice-timeout', 'daily-timeout')
  ),
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0 AND duration_ms <= 3600000),
  attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
  module_count INTEGER NOT NULL CHECK (module_count >= 0),
  completed_modules INTEGER NOT NULL CHECK (
    completed_modules >= 0 AND completed_modules <= module_count
  ),
  strike_count INTEGER NOT NULL CHECK (strike_count >= 0),
  finished_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, source_key)
);

CREATE INDEX idx_arcade_bombsquad_user_finished
  ON arcade_profile_bombsquad_run (user_id, finished_at DESC, source_key DESC);

CREATE TABLE arcade_profile_oracle_sign (
  user_id TEXT NOT NULL,
  source_key TEXT NOT NULL,
  profile_id TEXT,
  session_id TEXT NOT NULL,
  sign_date TEXT NOT NULL,
  ben TEXT NOT NULL,
  bian TEXT NOT NULL,
  yao_values TEXT NOT NULL,
  created_at TEXT NOT NULL,
  inserted_at TEXT NOT NULL,
  PRIMARY KEY (user_id, source_key)
);

CREATE INDEX idx_arcade_oracle_user_created
  ON arcade_profile_oracle_sign (user_id, created_at DESC, source_key DESC);
