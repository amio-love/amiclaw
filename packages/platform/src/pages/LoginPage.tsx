import { useState, type FormEvent } from 'react'
import { Button, EyebrowTag, GlassCard } from '@amiclaw/ui'
import type { MagicLinkRequestBody } from '@shared/auth-types'
import { API_BASE } from '@shared/api-base'
import styles from './LoginPage.module.css'

/* Google sign-in start endpoint. A plain navigational link, NOT a fetch: the
   browser must follow the 302 to Google's consent screen and back. */
const GOOGLE_START_URL = `${API_BASE}/api/auth/google/start`

/* Unified anti-enumeration confirmation. Mirrors the backend's invariant ④:
   the same message is shown whether or not the email is known, so the page
   never reveals which addresses can sign in. */
const UNIFIED_CONFIRMATION = '如果该邮箱可用，你会收到一封登录邮件。'

type Phase = 'idle' | 'submitting' | 'sent' | 'error'

/* Two real sign-in paths, both converging on one server session: the email
   magic-link (POST /api/auth/magic-link/request → confirmation), and Google
   OAuth (a link to GET /api/auth/google/start, which 302s to Google's consent
   screen). The Google option is a live link now that the start endpoint exists.
   Platform chrome — brand yellow, dark-only, CSS-only transitions. */
export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (phase === 'submitting') return
    setPhase('submitting')

    const body: MagicLinkRequestBody = { email }
    try {
      // Any completed request — known, unknown, malformed, or rate-limited —
      // resolves to the same unified confirmation (anti-enumeration). Only a
      // true network failure surfaces a retry.
      await fetch(`${API_BASE}/api/auth/magic-link/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      setPhase('sent')
    } catch {
      setPhase('error')
    }
  }

  return (
    <div className={styles.page}>
      <EyebrowTag variant="section">登录 · SIGN IN</EyebrowTag>
      <h2 className={styles.title}>
        用邮箱<span className={styles.accent}>登录</span>。
      </h2>
      <p className={styles.lead}>输入邮箱，我们会发一封登录邮件，点开链接即可登录。无需密码。</p>

      <GlassCard radius="2xl" className={styles.card}>
        {phase === 'sent' ? (
          <p className={styles.confirmation} role="status">
            {UNIFIED_CONFIRMATION}
          </p>
        ) : (
          <>
            <form className={styles.form} onSubmit={onSubmit}>
              <label className={styles.label} htmlFor="login-email">
                邮箱
              </label>
              <input
                id="login-email"
                className={styles.input}
                type="email"
                name="email"
                autoComplete="email"
                required
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={phase === 'submitting'}
              />
              {phase === 'error' && (
                <p className={styles.errorText} role="alert">
                  发送失败，请检查网络后重试。
                </p>
              )}
              <Button type="submit" variant="primary" disabled={phase === 'submitting'}>
                {phase === 'submitting' ? '发送中…' : '发送登录邮件'}
              </Button>
            </form>

            <div className={styles.divider} aria-hidden="true">
              <span>或</span>
            </div>

            {/* A real navigational link — the browser follows the 302 to Google.
                Styled to mirror the @amiclaw/ui ghost button (dark glass outline). */}
            <a className={styles.googleButton} href={GOOGLE_START_URL}>
              <GoogleMark />用 Google 登录
            </a>
          </>
        )}
      </GlassCard>
    </div>
  )
}

/* Google "G" mark — the official four-colour logo, inline SVG so no asset fetch
   and no JS animation. Decorative; the link text carries the accessible name. */
function GoogleMark() {
  return (
    <svg className={styles.googleMark} viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.05l3.01-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  )
}
