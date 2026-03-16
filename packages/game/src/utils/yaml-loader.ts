import yaml from 'js-yaml'
import type { Manual } from '@shared/manual-schema'

const CACHE = new Map<string, Manual>()

export async function loadManual(url: string): Promise<Manual> {
  if (CACHE.has(url)) return CACHE.get(url)!

  const res = await fetch(url, {
    headers: { Accept: 'application/yaml, text/plain' },
  })
  if (!res.ok) {
    throw new Error(`Failed to load manual: ${res.status} ${res.statusText}`)
  }
  const text = await res.text()
  const manual = yaml.load(text) as Manual
  CACHE.set(url, manual)
  return manual
}
