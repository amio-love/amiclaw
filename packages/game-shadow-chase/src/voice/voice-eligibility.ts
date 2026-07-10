import { useEffect, useState } from 'react'

export type ShadowVoiceEligibility =
  | { status: 'checking' }
  | { status: 'eligible'; companionName: string }
  | { status: 'ineligible'; reason: 'anonymous' | 'no-companion' | 'unavailable' }

interface SessionBody {
  authenticated?: boolean
}

interface CompanionBody {
  name?: unknown
}

export async function checkShadowVoiceEligibility(
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal
): Promise<ShadowVoiceEligibility> {
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

export function useShadowVoiceEligibility(enabled: boolean): ShadowVoiceEligibility {
  const [eligibility, setEligibility] = useState<ShadowVoiceEligibility>(
    enabled ? { status: 'checking' } : { status: 'ineligible', reason: 'unavailable' }
  )

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    let active = true
    void checkShadowVoiceEligibility(fetch, controller.signal).then((result) => {
      if (active) setEligibility(result)
    })
    return () => {
      active = false
      controller.abort()
    }
  }, [enabled])

  return eligibility
}
