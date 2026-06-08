/**
 * Pure token / hashing primitives for the Auth Session component.
 *
 * Workers-runtime only — uses Web Crypto (`crypto.getRandomValues`,
 * `crypto.randomUUID`, `crypto.subtle.digest`). No Node-only dependency, so it
 * runs unchanged in Cloudflare Pages Functions and in the Node test runner
 * (Node ≥ 18 exposes the same global `crypto`).
 *
 * Invariant ② lives here: the server only ever stores the SHA-256 hash of a
 * magic-link token (`hashToken`); the plaintext token never touches KV.
 */

// 32 random bytes → 256 bits of entropy, hex-encoded to a 64-char token. Far
// above any brute-force concern for a ≤15-minute single-use credential.
const TOKEN_BYTES = 32

/** Generate a high-entropy, URL-safe magic-link token (hex string). */
export function generateToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES)
  crypto.getRandomValues(bytes)
  return bytesToHex(bytes)
}

/** Generate an opaque, unguessable session id (UUID v4). */
export function generateSessionId(): string {
  return crypto.randomUUID()
}

/**
 * SHA-256 hash a token to its hex digest.
 *
 * This is the value stored in KV under `magiclink:<sha256>` (invariant ②). The
 * digest is deterministic, so `verify` can recompute it from the plaintext
 * token carried in the verify URL and look the key up directly.
 */
export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return bytesToHex(new Uint8Array(digest))
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = ''
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0')
  }
  return hex
}
