/**
 * Loads the botanical-garden GameType + every level from the canonical fixtures
 * that live in @amiclaw/creation. The fixtures stay the SSOT there (so the
 * engine + validator suites cover them); the player app reads the same YAML via
 * Vite's `?raw` import and the creation loader.
 *
 * Levels are discovered data-driven from the fixtures directory (`import.meta.glob`)
 * and keyed by their own `metadata.id`, so a new `level.*.yaml` becomes playable
 * (and manual-renderable) with no code change here.
 */
import { loadGameType, loadLevel } from '@amiclaw/creation'
import type { GameType, Level } from '@amiclaw/creation'
import gameTypeYaml from '../../../creation/fixtures/botanical-garden/game-type.yaml?raw'

export const botanicalGameType: GameType = loadGameType(gameTypeYaml)

export interface LevelEntry {
  id: string
  title: string
  level: Level
}

const levelYamls = import.meta.glob('../../../creation/fixtures/botanical-garden/level.*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/** All botanical levels, sorted by id (bg-demo-001 before bg-standard-001). */
export const levels: LevelEntry[] = Object.values(levelYamls)
  .map((raw) => {
    const level = loadLevel(raw)
    return { id: level.metadata.id, title: level.metadata.title, level }
  })
  .sort((a, b) => a.id.localeCompare(b.id))

export const DEFAULT_LEVEL_ID = 'bg-demo-001'

const tutorialEntry: LevelEntry = levels.find((entry) => entry.id === DEFAULT_LEVEL_ID) ?? levels[0]

/** Resolve a level by id, falling back to the tutorial when the id is unknown. */
export function levelById(id: string | null | undefined): LevelEntry {
  return levels.find((entry) => entry.id === id) ?? tutorialEntry
}

/** The tutorial level (bg-demo-001) — the default run. */
export const tutorialLevel: Level = tutorialEntry.level
