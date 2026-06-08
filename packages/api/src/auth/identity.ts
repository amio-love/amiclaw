/**
 * Derive a stable `user_id` from a proven-owned email.
 *
 * This round has no separate user store (the account / device-link model is
 * owned by `migrate-leaderboard-to-user-id`). The identity anchor is therefore
 * derived deterministically from the normalized email: the same email always
 * yields the same `user_id`, and the value is a SHA-256 hex digest rather than
 * the raw email — so a `user_id` flowing through downstream systems (e.g. a
 * leaderboard key) does not leak the player's address.
 *
 * When the real account store lands, this derivation can be replaced by a
 * lookup/insert without changing the wire shape (`AuthIdentity.user_id`).
 */

import { hashToken } from './crypto'

export async function deriveUserId(email: string): Promise<string> {
  // Reuse SHA-256 over the normalized email. Prefix-free since the magic-link
  // hash is over a random token, never an email, so the spaces never collide.
  return hashToken(`user:${email}`)
}
