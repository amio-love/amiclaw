import { useCallback, useEffect, useState } from 'react'
import type { CompanionIdentity } from '@shared/companion-types'
import { fetchCompanion, type CompanionStats } from '@/lib/companion-api'

/**
 * The companion identity read (`GET /api/companion`, or the dev seed). Used by
 * the AccountPage companion card and the onboarding page to decide
 * setup-vs-already-created and to render "你的伙伴 X".
 *
 *   - `loading` — the read is in flight (or `enabled` is false and no read has
 *                 run yet); the host holds chrome only.
 *   - `none`    — 404: no companion yet → the onboarding form / setup CTA.
 *   - `exists`  — the identity is loaded.
 *   - `error`   — network / unexpected failure.
 *
 * `enabled` gates the fetch (the host passes `seeded || signed-in`); `reload`
 * re-reads — the onboarding page calls it after a successful setup so the
 * identity is read back from the source of truth.
 */
export type CompanionState =
  | { status: 'loading'; companion: null }
  | { status: 'none'; companion: null }
  | { status: 'exists'; companion: CompanionIdentity; stats?: CompanionStats }
  | { status: 'error'; companion: null }

export function useCompanion(enabled: boolean): {
  state: CompanionState
  reload: () => void
} {
  const [state, setState] = useState<CompanionState>({ status: 'loading', companion: null })
  const [nonce, setNonce] = useState(0)
  const reload = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    if (!enabled) return
    let active = true
    fetchCompanion().then((result) => {
      if (!active) return
      if (result.kind === 'exists') {
        setState({ status: 'exists', companion: result.companion, stats: result.stats })
      } else if (result.kind === 'none') {
        setState({ status: 'none', companion: null })
      } else {
        setState({ status: 'error', companion: null })
      }
    })
    return () => {
      active = false
    }
  }, [enabled, nonce])

  return { state, reload }
}
