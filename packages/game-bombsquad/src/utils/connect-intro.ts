/**
 * Per-device first-run gating for the connect-AI intro (F1).
 *
 * A brand-new anonymous player entering the BombSquad connect flow gets one
 * honest primer explaining the unconventional premise (you + a voice AI partner
 * splitting the bomb vs the manual), and — for players with no voice AI at hand
 * — the platform-companion path. It shows ONCE per device: the first time the
 * BYO connect flow is reached, and never again after it is dismissed. Mirrors
 * the survey.ts per-device flag pattern.
 */

const CONNECT_INTRO_SEEN_KEY = 'bombsquad-connect-intro-seen'

/**
 * Returns true when this device has already seen (and dismissed) the connect
 * intro. Returns false when the flag is absent or localStorage access throws
 * (private mode / disabled) — a read failure errs toward showing the primer
 * once more rather than silently suppressing it forever.
 */
export function hasSeenConnectIntro(): boolean {
  try {
    return localStorage.getItem(CONNECT_INTRO_SEEN_KEY) === 'true'
  } catch {
    return false
  }
}

/**
 * Marks the connect intro as seen for this device. Storage failures (quota /
 * private mode) are swallowed — the only consequence is the primer may show
 * again on a later entry, which is acceptable.
 */
export function markConnectIntroSeen(): void {
  try {
    localStorage.setItem(CONNECT_INTRO_SEEN_KEY, 'true')
  } catch {
    /* storage full / disabled — intro simply shows again next time */
  }
}
