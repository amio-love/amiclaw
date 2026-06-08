import { useState, type FormEvent } from 'react'
import { Button, EyebrowTag, GlassCard } from '@amiclaw/ui'
import type { MagicLinkRequestBody } from '@shared/auth-types'
import { API_BASE } from '@shared/api-base'
import styles from './LoginPage.module.css'

/* Unified anti-enumeration confirmation. Mirrors the backend's invariant ④:
   the same message is shown whether or not the email is known, so the page
   never reveals which addresses can sign in. */
const UNIFIED_CONFIRMATION = '如果该邮箱可用，你会收到一封登录邮件。'

type Phase = 'idle' | 'submitting' | 'sent' | 'error'

/* Magic-link login — email only. The player enters an email; the page POSTs to
   /api/auth/magic-link/request and shows the unified confirmation on success.

   Email flow ONLY this round. No Google button: the /api/auth/google/start
   endpoint does not exist yet (Round 3), and a dead/placeholder button would
   violate the no-「即将推出」rule. Platform chrome — brand yellow, dark-only. */
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
        )}
      </GlassCard>
    </div>
  )
}
