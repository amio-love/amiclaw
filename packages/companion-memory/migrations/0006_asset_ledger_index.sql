-- Migration 0006 — Asset ledger read index (reward economy v1).
--
-- Additive, correctness-neutral index. The reward-economy ledger layer reads
-- `asset_entry` in two hot shapes that both narrow by (user_id, asset_type):
--
--   readBalance             SUM(amount) WHERE user_id = ? AND asset_type = ?
--   countTodaysRewardedWins COUNT(*)    WHERE user_id = ? AND asset_type = ?
--                                         AND source_key GLOB 'win:*'
--                                         AND earned_at IN [today, tomorrow)
--
-- The existing `idx_asset_user (user_id, earned_at DESC)` (migration 0001) does
-- not carry `asset_type`, so both queries would scan every entry the user owns
-- as the append-only ledger grows. This composite index keeps them index-served
-- (the daily-cap `source_key GLOB 'win:*'` is a cheap residual over the already
-- per-user-per-day-narrowed set). No column, constraint, or trigger changes.

CREATE INDEX idx_asset_user_type ON asset_entry (user_id, asset_type, earned_at DESC);
