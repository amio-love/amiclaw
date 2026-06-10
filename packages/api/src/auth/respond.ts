/**
 * Shared response builders for the auth handlers + the unified
 * anti-enumeration response (invariant ④).
 */

import type { MagicLinkRequestResponse } from '../../../../shared/auth-types'

export function jsonResponse(
  body: unknown,
  status: number,
  headers?: Record<string, string>
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

/**
 * The single unified response for `POST /api/auth/magic-link/request`.
 *
 * Invariant ④: returned IDENTICALLY whether the email is known, unknown,
 * malformed, or rate-limited — the caller can never distinguish a registered
 * address from an unregistered one, nor a throttled request from a fresh one.
 * Always 200 with the same body.
 */
export function unifiedMagicLinkResponse(): Response {
  const body: MagicLinkRequestResponse = {
    ok: true,
    message: 'If that email can sign in, a link is on its way.',
  }
  return jsonResponse(body, 200)
}

/**
 * Basic email shape check + normalization. Lowercased + trimmed so the same
 * address always maps to one rate-limit key and one identity. Deliberately
 * permissive — exact RFC validation is not worth the surface, and an invalid
 * address simply yields the same unified response (no send happens).
 */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const email = raw.trim().toLowerCase()
  if (email.length === 0 || email.length > 254) return null
  // One `@`, non-empty local + domain, a dot in the domain, no whitespace.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null
  return email
}
