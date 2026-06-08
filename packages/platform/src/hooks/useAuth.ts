import { useEffect, useState } from 'react'
import type { AuthIdentity, SessionResponse } from '@shared/auth-types'
import { API_BASE } from '@shared/api-base'

/**
 * Display identity derived from the real session. The session carries only
 * `{ user_id, email }` (no displayName / avatarLetter / stats) — those are
 * derived here from the email local-part so the UI has something honest to
 * render without inventing data. `email` is kept for surfaces that want the
 * full address.
 */
export interface DisplayUser {
  user_id: string
  email: string
  /** Email local-part (before `@`); the human-facing name until profiles exist. */
  displayName: string
  /** First character of the local-part, upper-cased — the avatar glyph. */
  avatarLetter: string
}

/**
 * Real auth state, read from `GET /api/auth/session`.
 *
 *   - `loading`  — the session fetch is in flight; consumers must NOT render
 *                  signed-out chrome yet (would flash and snap).
 *   - `authed`   — a valid session exists; `user` is the derived identity.
 *   - `anon`     — no session; `user` is null.
 */
export type AuthState =
  | { status: 'loading'; user: null }
  | { status: 'authed'; user: DisplayUser }
  | { status: 'anon'; user: null }

function deriveDisplayUser(identity: AuthIdentity): DisplayUser {
  const localPart = identity.email.split('@')[0] ?? identity.email
  const displayName = localPart.length > 0 ? localPart : identity.email
  const avatarLetter = displayName.charAt(0).toUpperCase()
  return { user_id: identity.user_id, email: identity.email, displayName, avatarLetter }
}

/**
 * Dev-only auth bypass — compiled OUT of the production build.
 *
 * `import.meta.env.DEV` is statically `false` in `vite build`, so this whole
 * branch is dead-code-eliminated from the prod bundle: production has zero
 * bypass and always reads the real session. In `pnpm dev`, set
 * `VITE_DEV_AUTH_BYPASS` to a fake email (e.g. `dev@amio.fans`) to render the
 * signed-in chrome without a backend. Returns `undefined` when not bypassing.
 */
function devBypassState(): AuthState | undefined {
  if (!import.meta.env.DEV) return undefined
  const bypass = import.meta.env.VITE_DEV_AUTH_BYPASS as string | undefined
  if (!bypass) return undefined
  return { status: 'authed', user: deriveDisplayUser({ user_id: 'dev-bypass', email: bypass }) }
}

/**
 * Reads the real, revocable session built in Round 1. The fetch is async, so
 * the state starts in `loading` and resolves to `authed` / `anon` — consumers
 * branch on `status` and hold off signed-out chrome while `loading`.
 *
 * Anonymous is a 200 with `authenticated: false` (asking "am I logged in?" is
 * always legal), so any non-`authenticated` response — including a network
 * failure — resolves to `anon`, never an error UI.
 */
export function useAuth(): AuthState {
  const bypass = devBypassState()
  const [state, setState] = useState<AuthState>(bypass ?? { status: 'loading', user: null })

  useEffect(() => {
    // Dev bypass is resolved synchronously above; skip the network read.
    if (bypass) return

    let active = true
    fetch(`${API_BASE}/api/auth/session`, { credentials: 'include' })
      .then((res) => (res.ok ? (res.json() as Promise<SessionResponse>) : null))
      .then((body) => {
        if (!active) return
        if (body?.authenticated && body.identity) {
          setState({ status: 'authed', user: deriveDisplayUser(body.identity) })
        } else {
          setState({ status: 'anon', user: null })
        }
      })
      .catch(() => {
        if (active) setState({ status: 'anon', user: null })
      })
    return () => {
      active = false
    }
    // `bypass` is a stable per-build value (env-derived); the effect runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return state
}
