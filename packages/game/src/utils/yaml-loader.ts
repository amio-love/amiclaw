import yaml from 'js-yaml'
import type { Manual } from '@shared/manual-schema'

const CACHE = new Map<string, Manual>()

/**
 * Thrown when the manual endpoint returns 404 — typically a daily manual
 * URL that has not been published yet. Callers should render a dedicated
 * "not published" UI instead of a generic load error.
 */
export class ManualNotFoundError extends Error {
  readonly kind = 'not_published' as const

  constructor(url: string) {
    super(`Manual not published at ${url}`)
    this.name = 'ManualNotFoundError'
  }
}

export async function loadManual(url: string): Promise<Manual> {
  if (CACHE.has(url)) return CACHE.get(url)!

  const res = await fetch(url, {
    headers: { Accept: 'application/yaml, text/plain' },
  })
  if (res.status === 404) {
    throw new ManualNotFoundError(url)
  }
  if (!res.ok) {
    throw new Error(`Failed to load manual: ${res.status} ${res.statusText}`)
  }
  const text = await res.text()
  const manual = yaml.load(text) as Manual
  CACHE.set(url, manual)
  return manual
}
