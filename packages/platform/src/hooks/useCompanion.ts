import { useCallback, useEffect, useSyncExternalStore } from 'react'
import type { CompanionIdentity } from '@shared/companion-types'
import { fetchCompanion, type CompanionReadResult, type CompanionStats } from '@/lib/companion-api'

/**
 * The companion identity read (`GET /api/companion`, or the dev seed). Used by
 * the shell dock, the home presence (WelcomeStrip), the greeting-name hook, the
 * account card, and the onboarding page to decide setup-vs-already-created and
 * to render "你的伙伴 X".
 *
 *   - `loading` — the read has not resolved yet; the host holds chrome only.
 *   - `none`    — 404: no companion yet → the onboarding form / setup CTA.
 *   - `exists`  — the identity is loaded.
 *   - `error`   — network / unexpected failure.
 */
export type CompanionState =
  | { status: 'loading'; companion: null }
  | { status: 'none'; companion: null }
  | { status: 'exists'; companion: CompanionIdentity; stats: CompanionStats }
  | { status: 'error'; companion: null }

// --- Shared companion identity store -----------------------------------------
//
// The companion identity is a SINGLE shared resource: read once (deduped) and
// cached process-wide, so every host reads ONE result instead of each firing
// its own `GET /api/companion`. Before this store, each host owned an
// independent fetch with its own `loading → resolved` window; a late-mounting
// page-level host (WelcomeStrip, mounted only after `useAuth` resolves and the
// signed-in home renders) could get stuck rendering the neutral greeting
// fallback while its own in-flight (or remount-orphaned) fetch never reached
// the assertion window — the batch② presence-relocation regression. Sharing the
// read makes any host's mount read the already-resolved value from cache (and
// survive its own remount without re-entering loading).
//
// The cache is process-lifetime: the identity is immutable for a session (only
// setup creates it — the onboarding page busts the cache via `reload` — and
// logout hard-navigates, resetting module state), so a stale read cannot occur.

let companionCache: CompanionReadResult | null = null
let companionInflight: Promise<void> | null = null
const companionListeners = new Set<() => void>()

function emitCompanion(): void {
  for (const listener of companionListeners) listener()
}

function subscribeCompanion(listener: () => void): () => void {
  companionListeners.add(listener)
  return () => {
    companionListeners.delete(listener)
  }
}

function getCompanionSnapshot(): CompanionReadResult | null {
  return companionCache
}

/**
 * Trigger the shared read. Deduped: a load already in flight is never doubled.
 * `force` (reload) re-reads even when cached — the previous value stays visible
 * until the fresh read resolves (no loading flash on reload).
 */
function ensureCompanionLoaded(force = false): void {
  if (companionInflight) return
  if (companionCache && !force) return
  companionInflight = fetchCompanion()
    .then((result) => {
      companionCache = result
    })
    .catch(() => {
      companionCache = { kind: 'error' }
    })
    .finally(() => {
      companionInflight = null
      emitCompanion()
    })
}

/**
 * Test-only: clear the shared cache + in-flight tracking between tests. The
 * store is process-lifetime by design (see the note above), so unit tests that
 * render companion hosts across multiple cases must reset it to stay isolated.
 * Not for production use.
 */
export function __resetCompanionStore(): void {
  companionCache = null
  companionInflight = null
}

function toCompanionState(cached: CompanionReadResult | null): CompanionState {
  if (cached === null) return { status: 'loading', companion: null }
  switch (cached.kind) {
    case 'exists':
      return { status: 'exists', companion: cached.companion, stats: cached.stats }
    case 'none':
      return { status: 'none', companion: null }
    default:
      return { status: 'error', companion: null }
  }
}

/**
 * Read the shared companion identity. `enabled` gates whether THIS consumer
 * triggers the (deduped) load — a disabled consumer still reflects the shared
 * state if another host already loaded it. `reload` busts the shared cache and
 * re-reads; the onboarding page calls it after a successful setup so every host
 * re-reads the created identity from the source of truth.
 */
export function useCompanion(enabled: boolean): {
  state: CompanionState
  reload: () => void
} {
  const cached = useSyncExternalStore(
    subscribeCompanion,
    getCompanionSnapshot,
    getCompanionSnapshot
  )

  useEffect(() => {
    if (enabled) ensureCompanionLoaded()
  }, [enabled])

  const reload = useCallback(() => ensureCompanionLoaded(true), [])

  return { state: toCompanionState(cached), reload }
}
