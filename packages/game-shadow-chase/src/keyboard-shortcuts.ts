import type { EngineAction } from './engine/types'

export function resolveGameShortcut(
  code: string,
  repeat: boolean,
  focusedControl: boolean
): EngineAction | undefined {
  if (code !== 'Space' || repeat || focusedControl) return undefined
  return { type: 'swap' }
}
