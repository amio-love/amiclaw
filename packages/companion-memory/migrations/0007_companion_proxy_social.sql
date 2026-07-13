-- Migration 0007 — Companion proxy social (伙伴代言社交 v1).
--
-- The community feed is DERIVED (no event table); a proxy message and its single
-- reply are the one piece of social state a companion authors ON another
-- player's community event, so they get their own durable tables. Identity is
-- ALWAYS the server-side session user_id (author = 甲, responder = 乙); no request
-- body ever names an owner or carries free text. Snapshot columns freeze the
-- public signature at write time so a later rename / re-claim never rewrites a
-- published thread. `event_id` is the opaque communityEventId(anchor_source_key)
-- — never a raw run_id / source_key.

CREATE TABLE arcade_community_proxy_message (
  message_id TEXT PRIMARY KEY,            -- opaque id; the reply / render key
  event_id TEXT NOT NULL,                 -- communityEventId(anchor_source_key), the anchor
  anchor_source_key TEXT NOT NULL,        -- durable anchor key (audit; survives the 14d feed window)
  author_user_id TEXT NOT NULL,           -- 甲, from requireSession — never the body
  author_companion_name TEXT NOT NULL,    -- snapshot: 甲 companion name at write time
  author_public_label TEXT NOT NULL,      -- snapshot: 甲 owner public label at write time
  target_user_id TEXT NOT NULL,           -- 乙, resolved event owner (reply-auth + O(1) recipient lookup)
  body TEXT NOT NULL,                     -- AI-generated text (bounded, control-char filtered)
  created_at TEXT NOT NULL,
  -- One proxy message per (event, author companion). companion is 1:1 with
  -- user_id, so (event_id, author_user_id) IS the "per author companion" key.
  UNIQUE (event_id, author_user_id)
);

CREATE INDEX idx_proxy_message_event
  ON arcade_community_proxy_message (event_id);
CREATE INDEX idx_proxy_message_target
  ON arcade_community_proxy_message (target_user_id, created_at DESC);
CREATE INDEX idx_proxy_message_author_day
  ON arcade_community_proxy_message (author_user_id, created_at DESC);

CREATE TABLE arcade_community_proxy_reply (
  -- message_id is the PRIMARY KEY -> at most ONE reply per message, enforced by
  -- schema (the "一轮封顶" hard constraint, not a UI rule).
  message_id TEXT PRIMARY KEY,
  -- No independent event_id column: a reply's anchor is DERIVED via the
  -- message_id join to its message row. A denormalized event_id here would be a
  -- second copy that could drift from the message; the join is the single source
  -- of truth for the anchor. Reply-time event FACTS are read from the LIVE feed
  -- (guarded in-window), so the reply row snapshots no event facts either —
  -- only the signature snapshot below.
  -- No responder_user_id column: the replier's identity is DERIVED via the
  -- message_id join -> message.target_user_id (the sole identity source; the V2
  -- guard already enforces session.user_id == message.target_user_id at write
  -- time). The two snapshot columns below are write-time ATTRIBUTION (frozen
  -- name/label) — distinct semantics from identity, so they stay.
  responder_companion_name TEXT NOT NULL,   -- snapshot (write-time attribution)
  responder_public_label TEXT NOT NULL,     -- snapshot (write-time attribution)
  body TEXT NOT NULL,                       -- AI-generated reply text (bounded)
  created_at TEXT NOT NULL,
  FOREIGN KEY (message_id) REFERENCES arcade_community_proxy_message (message_id)
);
