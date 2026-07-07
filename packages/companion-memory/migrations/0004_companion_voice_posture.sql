-- Migration 0004 — companion voice posture (presence layer, additive only).
--
-- Account-level memory of the auto-voice posture ruled in
-- companion-presence-design §姿态记忆模型:
--
--   voice-default      auto-voice on login (initial posture of every companion)
--   quiet-remembered   the player muted / downgraded voice; future visits land quiet
--   denied-remembered  the browser mic permission was denied; never auto-re-prompt
--
-- One column on the existing 1:1 companion row (not a settings side table):
-- the posture is a single scalar per companion, read on every identity fetch
-- (`GET /api/companion`) and written by `PUT /api/companion/settings`. The
-- client keeps a localStorage cache (`amio_companion_voice_posture`) for the
-- pre-API read at page load; this column is the cross-device SSOT.

ALTER TABLE companion
  ADD COLUMN voice_posture TEXT NOT NULL DEFAULT 'voice-default'
    CHECK (voice_posture IN ('voice-default', 'quiet-remembered', 'denied-remembered'));
