import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button, EyebrowTag, GlassCard } from '@amiclaw/ui'
import {
  MAGIC_LINK_TTL_MINUTES,
  MAGIC_LINK_HOURLY_SEND_LIMIT,
  type MagicLinkRequestBody,
} from '@shared/auth-types'
import { API_BASE } from '@shared/api-base'
import { useAuth, type DisplayUser } from '@/hooks/useAuth'
import styles from './LoginPage.module.css'

/* Google sign-in start endpoint. A plain navigational link, NOT a fetch: the
   browser must follow the 302 to Google's consent screen and back. */
const GOOGLE_START_URL = `${API_BASE}/api/auth/google/start`

/* Unified anti-enumeration confirmation. Mirrors the backend's invariant ④:
   the same message is shown whether or not the email is known, so the page
   never reveals which addresses can sign in. */
const UNIFIED_CONFIRMATION = '如果该邮箱可用，你会收到一封登录邮件。'

/* Client-side resend cooldown. A UX pace-keeper only — the real abuse cap is
   the backend's per-email hourly limit, which the copy below states honestly
   (the unified response makes an over-cap send indistinguishable client-side). */
const RESEND_COOLDOWN_SECONDS = 60

/* Copy for every `?error=` value the auth backend 302s to /login with.
   Sources: magic-link verify (invalid / rate_limited), Google OAuth start
   (google_unavailable) and callback (google_denied / invalid_state / invalid /
   google_failed / email_unverified). Each entry says what happened and what to
   do next; the form below stays ready so the player can act immediately. */
const LOGIN_ERROR_COPY: Record<string, string> = {
  invalid: `登录链接已失效或已被使用。链接只能使用一次、${MAGIC_LINK_TTL_MINUTES} 分钟内有效 —— 在下方重新输入邮箱，获取一封新的登录邮件。`,
  rate_limited: '登录验证请求过于频繁，系统暂时限流。请稍等几分钟，再重新获取登录链接。',
  google_unavailable: 'Google 登录暂未开放。请先用下方邮箱获取登录链接。',
  google_denied: 'Google 登录已取消。可以重新点击 Google 登录，或改用邮箱获取登录链接。',
  invalid_state: 'Google 登录会话已过期，请重新发起一次 Google 登录。',
  google_failed: 'Google 登录没有完成，请重试；也可以改用邮箱获取登录链接。',
  email_unverified: '这个 Google 账号的邮箱尚未通过 Google 验证，请改用下方邮箱获取登录链接。',
}

/* Backends may add error values; an unknown value still deserves an honest
   explanation instead of a silent dead end. */
const LOGIN_ERROR_FALLBACK = '登录没有完成。请在下方重新输入邮箱，获取一封新的登录邮件。'

function loginErrorText(error: string | null): string | null {
  if (!error) return null
  return LOGIN_ERROR_COPY[error] ?? LOGIN_ERROR_FALLBACK
}

type Phase = 'idle' | 'submitting' | 'sent' | 'error'

/* The mode① bring-your-own-AI play entry — the BombSquad SPA root. Crossing the
   app boundary is a full-page navigation (same pattern as the homepage hero),
   not a client-side router push. */
function startWithOwnAI() {
  window.location.assign('/bombsquad/')
}

/* The login page is one clean card, not a wall of text.
   - The card is the single focal point: the email magic-link form and the
     Google option converge on one server session.
   - One quiet line under the card carries the honest why: an account now
     delivers three real things — the platform AI companion (mode②, live in
     co-play), a community feed of real player activity, and cross-device
     progress via account claim — so the line states current value, not a
     promise.
   - The escape — playing needs no account — sits as a subtle footer link into
     free anonymous play.
   Platform chrome — brand yellow, dark-only, CSS-only transitions. */
export default function LoginPage() {
  const { status, user, logout } = useAuth()
  const [searchParams] = useSearchParams()
  const [email, setEmail] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [resendCooldown, setResendCooldown] = useState(0)
  const [resending, setResending] = useState(false)

  // The verify / OAuth endpoints land their failures here as ?error=<value>.
  // Rendered until a send succeeds — the form stays ready right below it.
  const errorParam = loginErrorText(searchParams.get('error'))

  // Tick the resend cooldown down once per second while the sent panel shows.
  // setState fires only inside the timeout callback, never synchronously in
  // the effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (phase !== 'sent' || resendCooldown <= 0) return
    const id = setTimeout(() => setResendCooldown((s) => s - 1), 1000)
    return () => clearTimeout(id)
  }, [phase, resendCooldown])

  // POST the magic-link request. Any completed request — known, unknown,
  // malformed, or rate-limited — resolves to the same unified confirmation
  // (anti-enumeration). Only a true network failure returns false.
  async function sendRequest(): Promise<boolean> {
    const body: MagicLinkRequestBody = { email }
    try {
      await fetch(`${API_BASE}/api/auth/magic-link/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      return true
    } catch {
      return false
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (phase === 'submitting') return
    setPhase('submitting')
    if (await sendRequest()) {
      setPhase('sent')
      setResendCooldown(RESEND_COOLDOWN_SECONDS)
    } else {
      setPhase('error')
    }
  }

  // Resend keeps the sent panel in place (no flip back to the form while in
  // flight); a network failure drops back to the form with the retry line.
  async function onResend() {
    if (resending || resendCooldown > 0) return
    setResending(true)
    const ok = await sendRequest()
    setResending(false)
    if (ok) {
      setResendCooldown(RESEND_COOLDOWN_SECONDS)
    } else {
      setPhase('error')
    }
  }

  // An already-authenticated visitor on /login gets their identity and the two
  // honest next steps, not the bare form. Loading and anonymous both fall
  // through to the sign-in form: /login is anonymous-by-default, so the form is
  // shown optimistically rather than holding the page blank while the session
  // read is in flight.
  if (status === 'authed' && user) return <AuthedNotice user={user} onLogout={logout} />

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <EyebrowTag variant="section">登录 · SIGN IN</EyebrowTag>
        {/* /login is anonymous-by-default (new AND returning visitors land
            here), so the greeting must not assume a return — a neutral
            「欢迎你」 replaces the old「欢迎回来」(audit F8). */}
        <h2 className={styles.title}>
          欢迎<span className={styles.accent}>你</span>。
        </h2>
      </div>

      <GlassCard radius="2xl" className={styles.card}>
        {phase === 'sent' ? (
          <div className={styles.sentPanel}>
            <p className={styles.confirmation} role="status">
              {UNIFIED_CONFIRMATION}
            </p>
            {/* Echo of the player's own typed address — leaks nothing the
                player didn't already know, and catches typos early. */}
            <p className={styles.sentEmail}>{email}</p>
            <ul className={styles.sentHints}>
              <li>登录链接 {MAGIC_LINK_TTL_MINUTES} 分钟内有效，且只能使用一次。</li>
              <li>没收到？看看垃圾邮件或推广分类，也可能晚到一两分钟。</li>
            </ul>
            <Button variant="ghost" onClick={onResend} disabled={resending || resendCooldown > 0}>
              {resending
                ? '发送中…'
                : resendCooldown > 0
                  ? `重新发送（${resendCooldown} 秒后可用）`
                  : '重新发送登录邮件'}
            </Button>
            <p className={styles.sentRateNote}>
              同一邮箱一小时内最多发送 {MAGIC_LINK_HOURLY_SEND_LIMIT} 封登录邮件。
            </p>
            <button type="button" className={styles.switchEmail} onClick={() => setPhase('idle')}>
              换一个邮箱
            </button>
          </div>
        ) : (
          <>
            {errorParam && (
              <p className={styles.errorBanner} role="alert">
                {errorParam}
              </p>
            )}
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
                {phase === 'submitting' ? '发送中…' : '发送登录链接'}
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

      {/* The value of an account, stated as CURRENT product value — three
          things that are real today: the platform AI companion (mode②, live in
          co-play), a community feed built from real player activity, and
          cross-device progress via account claim. No「社交主场」overclaim (the
          community is a real-but-small activity feed, not a bustling social
          hub); no aspirational「你将拥有」framing (B6 copy-honesty sweep). */}
      <p className={styles.why}>
        登录后，你会有专属于你的 AI 伙伴、一处能看到同好动态的社区，以及跨设备同步的战绩与排名。
      </p>

      {/* The escape — playing needs no account. A subtle footer link into free
          anonymous play, not a heavy block. */}
      <p className={styles.escape}>
        玩游戏不需要登录。
        <button type="button" className={styles.escapeLink} onClick={startWithOwnAI}>
          带自己的 AI 直接开始玩
        </button>
      </p>
    </div>
  )
}

/* An already-authenticated visitor who lands on /login should not see the bare
   sign-in form. Show who they are and the two honest next steps: continue into
   the platform, or sign out. Same one-card layout and page-load reveal as the
   sign-in state. */
function AuthedNotice({ user, onLogout }: { user: DisplayUser; onLogout: () => void }) {
  const navigate = useNavigate()
  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <EyebrowTag variant="section">已登录 · SIGNED IN</EyebrowTag>
        <h2 className={styles.title}>
          你已<span className={styles.accent}>登录</span>。
        </h2>
      </div>

      <GlassCard radius="2xl" className={styles.card}>
        <p className={styles.identityLabel}>当前登录</p>
        <p className={styles.identityEmail}>{user.email}</p>
        <div className={styles.actions}>
          <Button variant="primary" onClick={() => navigate('/')}>
            继续
          </Button>
          <Button variant="ghost" onClick={onLogout}>
            退出登录
          </Button>
        </div>
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
