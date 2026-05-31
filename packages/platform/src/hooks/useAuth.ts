import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { mockUser, type MockUser } from '@/mocks/auth'

const STORAGE_KEY = 'amiclaw:auth'

export interface AuthState {
  signedIn: boolean
  user: MockUser | null
}

/* localStorage access is wrapped — private-mode browsers throw on read/write. */
function readStoredAuth(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'in'
  } catch {
    return false
  }
}

function persistAuth(value: 'in' | 'out'): void {
  try {
    localStorage.setItem(STORAGE_KEY, value)
  } catch {
    // ignore storage failures (private mode, quota, etc.)
  }
}

function resolveSignedIn(authParam: string | null): boolean {
  if (authParam === 'in') return true
  if (authParam === 'out') return false
  return readStoredAuth()
}

/**
 * Mock auth state for the development phase — there is no real backend.
 *
 * Resolution order:
 *   1. URL query `?auth=in` / `?auth=out` (also persisted to localStorage)
 *   2. localStorage['amiclaw:auth'] === 'in'
 *   3. default → signed out
 *
 * The demo「未登录 / 已登录」toggle pill from the prototype is intentionally
 * NOT shipped (handoff §12); the signed-in variant is reachable in dev via
 * `?auth=in` or `localStorage.setItem('amiclaw:auth', 'in')`.
 */
export function useAuth(): AuthState {
  const [searchParams] = useSearchParams()
  const authParam = searchParams.get('auth')

  // Persist an explicit ?auth= choice so it survives later navigation that
  // drops the query param. The persisted value is written in this effect;
  // signedIn below is derived purely, so no setState runs inside the effect.
  useEffect(() => {
    if (authParam === 'in' || authParam === 'out') {
      persistAuth(authParam)
    }
  }, [authParam])

  const signedIn = resolveSignedIn(authParam)
  return { signedIn, user: signedIn ? mockUser : null }
}
