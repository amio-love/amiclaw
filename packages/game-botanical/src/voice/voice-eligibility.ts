import { useEffect, useState } from 'react'

/**
 * Companion-voice eligibility for the botanist channel (copied from
 * game-shadow-chase's `voice-eligibility.ts` — the anonymous-vs-signed-in gate).
 * Signed-in players with a named account companion get their companion as the
 * botanist; everyone else falls back to the solo manual page (§3). A shared
 * `@shared/voice/voice-eligibility` lift is the clean follow-up now that a 2nd
 * game copies this.
 */
export type BotanicalVoiceEligibility =
  | { status: 'checking' }
  | { status: 'eligible'; companionName: string }
  | { status: 'ineligible'; reason: 'anonymous' | 'no-companion' | 'unavailable' }

interface SessionBody {
  authenticated?: boolean
}

interface CompanionBody {
  name?: unknown
}

export async function checkBotanicalVoiceEligibility(
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal
): Promise<BotanicalVoiceEligibility> {
  try {
    const sessionResponse = await fetcher('/api/auth/session', {
      credentials: 'include',
      signal,
    })
    if (!sessionResponse.ok) return { status: 'ineligible', reason: 'unavailable' }
    const session = (await sessionResponse.json()) as SessionBody
    if (!session.authenticated) return { status: 'ineligible', reason: 'anonymous' }

    const companionResponse = await fetcher('/api/companion', {
      credentials: 'include',
      signal,
    })
    if (companionResponse.status === 404) {
      return { status: 'ineligible', reason: 'no-companion' }
    }
    if (!companionResponse.ok) return { status: 'ineligible', reason: 'unavailable' }
    const companion = (await companionResponse.json()) as CompanionBody
    if (typeof companion.name !== 'string' || companion.name.trim().length === 0) {
      return { status: 'ineligible', reason: 'no-companion' }
    }
    return { status: 'eligible', companionName: companion.name.trim() }
  } catch {
    return { status: 'ineligible', reason: 'unavailable' }
  }
}

export function useBotanicalVoiceEligibility(enabled: boolean): BotanicalVoiceEligibility {
  const [eligibility, setEligibility] = useState<BotanicalVoiceEligibility>(
    enabled ? { status: 'checking' } : { status: 'ineligible', reason: 'unavailable' }
  )

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    let active = true
    void checkBotanicalVoiceEligibility(fetch, controller.signal).then((result) => {
      if (active) setEligibility(result)
    })
    return () => {
      active = false
      controller.abort()
    }
  }, [enabled])

  return eligibility
}
