/**
 * Global SFX mute — state, persistence, and React binding.
 *
 * The mute preference is a single module-level boolean, mirrored to
 * `localStorage` so it survives refresh / re-entry. The audio graph's master
 * GainNode (owned by `audio-context.ts`) is the enforcement point; this
 * module pushes every change down via `setMasterMuted` and syncs the audio
 * layer with the persisted value once at import time.
 *
 * React components read the state with `useMuted()` (built on
 * `useSyncExternalStore`) and flip it with `toggleMuted()`.
 */

import { useSyncExternalStore } from 'react'
import { setMasterMuted } from './audio-context'

const STORAGE_KEY = 'bombsquad:audio-muted'

/**
 * Reads the persisted preference. Defaults to false (audio on) when storage
 * is unavailable or unset — sound-on is the intended first-run experience.
 */
function readPersisted(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

let muted = readPersisted()
const listeners = new Set<() => void>()

// Sync the audio layer with the persisted preference at import time so a
// master gain created later (lazily, on first SFX) starts in the right state.
setMasterMuted(muted)

/** Current mute state. */
export function isMuted(): boolean {
  return muted
}

/**
 * Sets the mute state: updates the audio graph, persists to localStorage, and
 * notifies React subscribers. No-op when the value is unchanged.
 */
export function setMuted(next: boolean): void {
  if (next === muted) return
  muted = next
  setMasterMuted(muted)
  try {
    window.localStorage.setItem(STORAGE_KEY, String(muted))
  } catch {
    // Storage full / unavailable — in-memory state still applies this session.
  }
  for (const listener of listeners) listener()
}

/** Flips the current mute state. */
export function toggleMuted(): void {
  setMuted(!muted)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** React binding — re-renders the caller whenever the mute state flips. */
export function useMuted(): boolean {
  return useSyncExternalStore(subscribe, isMuted, isMuted)
}
