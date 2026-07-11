import { useEffect, useState } from 'react'

/**
 * Companion-voice eligibility for the mode② Sound Garden partner (copied from
 * game-botanical's `voice-eligibility.ts`). A signed-in player with a named
 * account companion gets the platform co_build partner; everyone else (anonymous,
 * no companion, or the standalone dev build with no Worker) falls back to the
 * offline scripted partner (§3). A shared `@shared/voice/voice-eligibility` lift is
 * the clean follow-up now that a third game copies this.
 */
export type SoundGardenVoiceEligibility =
  | { status: 'checking' }
  | { status: 'eligible'; companionName: string }
  | { status: 'ineligible'; reason: 'anonymous' | 'no-companion' | 'unavailable' }

interface SessionBody {
  authenticated?: boolean
}

interface CompanionBody {
  name?: unknown
}

export async function checkSoundGardenVoiceEligibility(
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal
): Promise<SoundGardenVoiceEligibility> {
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

export function useSoundGardenVoiceEligibility(enabled: boolean): SoundGardenVoiceEligibility {
  const [eligibility, setEligibility] = useState<SoundGardenVoiceEligibility>(
    enabled ? { status: 'checking' } : { status: 'ineligible', reason: 'unavailable' }
  )

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    let active = true
    void checkSoundGardenVoiceEligibility(fetch, controller.signal).then((result) => {
      if (active) setEligibility(result)
    })
    return () => {
      active = false
      controller.abort()
    }
  }, [enabled])

  return eligibility
}
