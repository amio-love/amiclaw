import { useCallback, useEffect, useState } from 'react'
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

/**
 * What `useAuth` returns: the read-only session state plus `logout` and the
 * optimistic auth hint. `logout` is stable across renders (`status`/`user`
 * still narrow as before), so every consumer can destructure it without
 * breaking the existing state branches.
 */
export type UseAuthResult = AuthState & {
  /** Revoke the session server-side, then return the whole UI to anonymous. */
  logout: () => Promise<void>
  /**
   * Client-persisted optimistic hint (localStorage): `true` when this device
   * last resolved to a signed-in session, so a returning signed-in visitor
   * does NOT paint the anonymous homepage before `GET /api/auth/session`
   * settles (auth-flash fix, rb-codescan Inv4 option 1). Only meaningful while
   * `status === 'loading'`; once the real read resolves, `status` is
   * authoritative and self-heals a stale hint (e.g. logged-out elsewhere).
   */
  optimisticAuthed: boolean
}

/**
 * Non-sensitive boolean flag remembering that this device last saw a signed-in
 * session. It is NOT a credential — the httpOnly session cookie remains the
 * only source of truth; this only decides which shell to hold during the first
 * async read so a returning signed-in user avoids the anonymous-hero flash.
 */
const AUTH_HINT_KEY = 'amio_auth_hint'

function readAuthHint(): boolean {
  try {
    return localStorage.getItem(AUTH_HINT_KEY) === '1'
  } catch {
    return false
  }
}

/** Sync the hint to a resolved state: set on `authed`, clear on `anon`. */
function persistAuthHint(state: AuthState): void {
  try {
    if (state.status === 'authed') localStorage.setItem(AUTH_HINT_KEY, '1')
    else if (state.status === 'anon') localStorage.removeItem(AUTH_HINT_KEY)
  } catch {
    // localStorage unavailable (private mode / disabled) — the hint is a pure
    // optimization; without it the returning-authed path simply flashes as
    // before, never an error.
  }
}

/**
 * Module-level dedup of the session read (F10). On any given page, TopNav +
 * CompanionDock + the page component (and more) each call `useAuth`, and each
 * used to fire its own `GET /api/auth/session` — ~11 requests across 4 pages.
 * Consumers mounting in the same render commit now share ONE in-flight read.
 *
 * The promise is cleared the moment it settles, so the dedup only collapses the
 * concurrent burst (where the redundancy was): each later client-side navigation
 * still re-reads a fresh session, and a transient network failure never poisons
 * a subsequent read.
 */
let sessionReadPromise: Promise<AuthState> | null = null

function readSessionState(): Promise<AuthState> {
  if (sessionReadPromise) return sessionReadPromise
  const pending = fetch(`${API_BASE}/api/auth/session`, { credentials: 'include' })
    .then((res) => (res.ok ? (res.json() as Promise<SessionResponse>) : null))
    .then(
      (body): AuthState =>
        body?.authenticated && body.identity
          ? { status: 'authed', user: deriveDisplayUser(body.identity) }
          : { status: 'anon', user: null }
    )
    .catch((): AuthState => ({ status: 'anon', user: null }))
    .then((state) => {
      // Refresh the optimistic hint from the authoritative read (self-heals a
      // stale hint on the same load).
      persistAuthHint(state)
      return state
    })
    .finally(() => {
      sessionReadPromise = null
    })
  sessionReadPromise = pending
  return pending
}

function deriveDisplayUser(identity: AuthIdentity): DisplayUser {
  const localPart = identity.email.split('@')[0] ?? identity.email
  // Strip the +tag plus-addressing suffix so a plus-aliased address
  // (e.g. `name+arcade-newuser@…`) never surfaces its raw internal alias as a
  // display name (audit F19). Greeting surfaces additionally prefer the
  // player's chosen nickname over this account-derived handle.
  const handle = localPart.split('+')[0] || localPart
  const displayName = handle.length > 0 ? handle : identity.email
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
export function useAuth(): UseAuthResult {
  const bypass = devBypassState()
  const [state, setState] = useState<AuthState>(bypass ?? { status: 'loading', user: null })
  // Read the hint once per mount. A dev bypass is already `authed`, so its
  // optimism is trivially true; otherwise the persisted hint drives it.
  const [optimisticAuthed] = useState<boolean>(() => (bypass ? true : readAuthHint()))

  /**
   * Log out: POST `/api/auth/logout` (idempotent — always clears the cookie),
   * then hard-navigate home. There is no shared auth store — TopNav, the
   * account page and each `useAuth` caller hold their own copy of the session
   * state — so a full navigation is the only reliable way to return every
   * surface to anonymous at once, and it re-reads the now-cleared session on
   * the fresh load. A failed request still falls through to the navigation; the
   * session endpoint is the source of truth on the next load.
   */
  const logout = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', credentials: 'include' })
    } catch {
      // Network failure — navigate anyway; the reloaded session read decides.
    }
    window.location.assign('/')
  }, [])

  useEffect(() => {
    // Dev bypass is resolved synchronously above; skip the network read.
    if (bypass) return

    let active = true
    readSessionState().then((next) => {
      if (active) setState(next)
    })
    return () => {
      active = false
    }
    // `bypass` is a stable per-build value (env-derived); the effect runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { ...state, logout, optimisticAuthed }
}
