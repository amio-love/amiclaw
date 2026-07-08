-- Migration 0005 — Arcade community feed likes.
--
-- The community feed itself is DERIVED (no event table): each feed item is
-- synthesized from the durable arcade-profile event rows (bombsquad runs,
-- oracle signs, streaks) joined to a claimed public profile. Likes are the one
-- piece of feed state that has no durable source, so they get their own table.
--
-- A like is (event identity, liker identity). `event_id` is the opaque,
-- deterministic feed-event token minted by `communityEventId(anchor_source_key)`
-- — never a raw run_id / source_key / user_id, so no private identifier is
-- persisted here as a key. The composite primary key makes every like idempotent
-- (a re-like is a no-op) and one-per-user-per-event by construction.

CREATE TABLE arcade_community_like (
  event_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (event_id, user_id)
);

-- Count-per-event and viewer-liked lookups both filter on event_id.
CREATE INDEX idx_arcade_community_like_event
  ON arcade_community_like (event_id);
