/**
 * Injectable magic-link email sender.
 *
 * `EmailSender` is the seam: the request handler takes a sender as an argument
 * so tests inject a mock and NEVER hit live email. The Resend-backed sender
 * isolates the single outbound `fetch` to `api.resend.com/emails` in one place
 * so the wire contract is easy to audit / update.
 *
 * Workers path: plain `fetch` only — no Resend Node SDK (which would pull a
 * Node-only dependency into the Workers runtime).
 */

import type { AuthEnv } from './config'
import { resolveEmailFrom } from './config'

export interface MagicLinkEmail {
  to: string
  /** Fully-built verify URL (carries the plaintext token in its query). */
  verifyUrl: string
}

export interface SendResult {
  sent: boolean
  /** Present when the send failed; used for audit / logging, never returned to the client. */
  error?: string
}

export type EmailSender = (email: MagicLinkEmail) => Promise<SendResult>

const RESEND_ENDPOINT = 'https://api.resend.com/emails'
const EMAIL_SUBJECT = 'Your AmiClaw sign-in link'

function renderHtml(verifyUrl: string): string {
  // Minimal, plain HTML. The link is the only actionable element.
  return [
    '<p>Click the link below to sign in to AmiClaw. It expires in 15 minutes and can be used once.</p>',
    `<p><a href="${verifyUrl}">Sign in to AmiClaw</a></p>`,
    `<p>If the link does not work, paste this URL into your browser:</p>`,
    `<p>${verifyUrl}</p>`,
    '<p>If you did not request this, you can ignore this email.</p>',
  ].join('\n')
}

function renderText(verifyUrl: string): string {
  return [
    'Click the link below to sign in to AmiClaw. It expires in 15 minutes and can be used once.',
    '',
    verifyUrl,
    '',
    'If you did not request this, you can ignore this email.',
  ].join('\n')
}

/**
 * Build the real Resend-backed sender from the env. When `RESEND_API_KEY` is
 * unset (local dev / preview without the secret), returns a no-op sender that
 * logs the link instead of sending — so the flow is exercisable end-to-end
 * without a Resend account and the dev fallback is safe (never silently
 * "succeeds" as if a real email went out to a stranger).
 */
export function createResendSender(env: AuthEnv): EmailSender {
  const apiKey = env.RESEND_API_KEY
  const from = resolveEmailFrom(env)

  if (!apiKey) {
    return async ({ verifyUrl }) => {
      // Dev-only: no secret configured. Surface the link to the worker log.
      // `warn` (not `info`) so it stands out and satisfies the no-console rule.
      console.warn(`[auth] RESEND_API_KEY unset — magic-link (dev): ${verifyUrl}`)
      return { sent: false, error: 'RESEND_API_KEY unset (dev fallback)' }
    }
  }

  return async ({ to, verifyUrl }) => {
    try {
      const response = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to,
          subject: EMAIL_SUBJECT,
          html: renderHtml(verifyUrl),
          text: renderText(verifyUrl),
        }),
      })
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        return { sent: false, error: `Resend ${response.status}: ${detail.slice(0, 200)}` }
      }
      return { sent: true }
    } catch (err) {
      return { sent: false, error: err instanceof Error ? err.message : 'send failed' }
    }
  }
}
