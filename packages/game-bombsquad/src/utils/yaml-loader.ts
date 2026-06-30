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

/**
 * Thrown when the manual body fetched from the server cannot be parsed as
 * YAML (js-yaml throws YAMLException). Distinct from network errors so the
 * UI can tell the user the manual itself is malformed and a network retry
 * won't help — they should report it instead.
 */
export class ManualParseError extends Error {
  readonly kind = 'yaml_parse' as const

  constructor(url: string, cause?: unknown) {
    super(`Manual YAML parse failed at ${url}`, cause !== undefined ? { cause } : undefined)
    this.name = 'ManualParseError'
  }
}

/**
 * Thrown when the manual could not be fetched due to a network-layer failure
 * (fetch reject) or a non-ok HTTP status other than 404. Callers may fall
 * back to a session-cached copy before surfacing this to the user.
 */
export class ManualNetworkError extends Error {
  readonly kind = 'network' as const
  readonly status?: number

  constructor(url: string, status?: number, cause?: unknown) {
    super(
      status !== undefined
        ? `Failed to load manual: ${status} at ${url}`
        : `Network error loading manual at ${url}`,
      cause !== undefined ? { cause } : undefined
    )
    this.name = 'ManualNetworkError'
    if (status !== undefined) this.status = status
  }
}

/**
 * Converts a daily manual HTML share URL (`/manual/<date>`) to its
 * machine-readable YAML data URL (`/manual/data/<date>.yaml`).
 *
 * The engine always fetches the YAML data file for puzzle generation; the HTML
 * page at `/manual/<date>` is the human/AI-readable share link. This helper
 * lets callers normalise the URL before fetching regardless of which form
 * they receive. If the URL is already a data URL (contains `/manual/data/`)
 * it is returned unchanged. URLs that do not match the expected pattern are
 * also returned unchanged (no silent data loss).
 */
export function toManualDataUrl(shareUrl: string): string {
  if (shareUrl.includes('/manual/data/')) return shareUrl
  return shareUrl.replace(/(\/manual\/)([0-9]{4}-[0-9]{2}-[0-9]{2})$/, '$1data/$2.yaml')
}

export async function loadManual(url: string): Promise<Manual> {
  if (CACHE.has(url)) return CACHE.get(url)!

  let res: Response
  try {
    res = await fetch(url, {
      headers: { Accept: 'application/yaml, text/plain' },
    })
  } catch (err) {
    throw new ManualNetworkError(url, undefined, err)
  }
  if (res.status === 404) {
    throw new ManualNotFoundError(url)
  }
  if (!res.ok) {
    throw new ManualNetworkError(url, res.status)
  }
  const text = await res.text()
  let manual: Manual
  try {
    manual = yaml.load(text) as Manual
  } catch (err) {
    throw new ManualParseError(url, err)
  }
  CACHE.set(url, manual)
  return manual
}
