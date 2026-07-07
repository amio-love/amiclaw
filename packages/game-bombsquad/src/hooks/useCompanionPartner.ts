/**
 * Companion co-play availability for the BombSquad entry flow.
 *
 * The connect page defaults a signed-in player WITH a companion into the
 * platform voice partner (mode②) instead of the BYO manual handoff. This hook
 * answers exactly that gate with two same-origin reads — the session cookie
 * rides along, no owner id is ever sent:
 *
 *   GET /api/auth/session  ->  authenticated?
 *   GET /api/companion     ->  companion identity (404 = not set up)
 *
 * `checking` keeps the page on neutral chrome (no flash of the wrong entry);
 * any failure resolves to `unavailable`, which leaves the anonymous /
 * companion-less flow byte-identical to today.
 */

import { useEffect, useState } from 'react'
import { API_BASE } from '@shared/api-base'
import { isVoicePosture } from '@shared/companion-types'
import { writeCachedVoicePosture } from '@shared/companion-presence'

export type CompanionPartnerState =
  | { status: 'checking' }
  | { status: 'available'; name: string }
  | { status: 'unavailable' }

interface SessionBody {
  authenticated?: boolean
}

interface CompanionBody {
  name?: unknown
  voice_posture?: unknown
}

export function useCompanionPartner(enabled: boolean): CompanionPartnerState {
  const [state, setState] = useState<CompanionPartnerState>(
    enabled ? { status: 'checking' } : { status: 'unavailable' }
  )

  useEffect(() => {
    if (!enabled) return
    let active = true
    void (async () => {
      try {
        const sessionRes = await fetch(`${API_BASE}/api/auth/session`, {
          credentials: 'include',
        })
        const session = sessionRes.ok ? ((await sessionRes.json()) as SessionBody) : null
        if (!session?.authenticated) {
          if (active) setState({ status: 'unavailable' })
          return
        }
        const companionRes = await fetch(`${API_BASE}/api/companion`, {
          credentials: 'include',
        })
        if (!companionRes.ok) {
          if (active) setState({ status: 'unavailable' })
          return
        }
        const companion = (await companionRes.json()) as CompanionBody
        // Opportunistic posture-cache sync: the account value is the SSOT, so
        // any surface holding a fresh identity read refreshes the local cache
        // (narrows the game SPA's cache-first staleness window — e.g. a
        // cross-device mute lands here before the run's settlement beat).
        if (isVoicePosture(companion.voice_posture)) {
          writeCachedVoicePosture(companion.voice_posture)
        }
        if (active) {
          setState(
            typeof companion.name === 'string' && companion.name.length > 0
              ? { status: 'available', name: companion.name }
              : { status: 'unavailable' }
          )
        }
      } catch {
        if (active) setState({ status: 'unavailable' })
      }
    })()
    return () => {
      active = false
    }
  }, [enabled])

  return state
}
