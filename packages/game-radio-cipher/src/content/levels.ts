/**
 * The playable's level registry. Each entry bundles everything a screen needs
 * to run one level: the shared radio-cipher GameType, the engine Level (loaded
 * through the real schema loader so it is structurally validated), the concrete
 * content segments, and display metadata.
 *
 * Level selection is carried in the URL hash (`#/?level=2`,
 * `#/codebook?level=2`) so the shareable codebook link always matches the
 * listener's current level. The engine Level YAML is loaded via Vite `?raw`;
 * unit tests read the same YAML from disk with node:fs (see the level-2 test),
 * so the two never drift.
 */

import { loadGameType, loadLevel } from '@amiclaw/creation'
import type { GameType, Level } from '@amiclaw/creation'
import gameTypeYaml from '../../../creation/fixtures/radio-cipher/game-type.yaml?raw'
import tutorialLevelYaml from '../../../creation/fixtures/radio-cipher/level.rc-demo-001.yaml?raw'
import deductionLevelYaml from './level.rc-demo-002.yaml?raw'
import { TUTORIAL_SEGMENTS, type PlayableSegment } from './tutorial-level'
import { DEDUCTION_SEGMENTS } from './deduction-level'

export interface PlayableLevel {
  /** URL-facing selector (`?level=<key>`). */
  key: string
  /** Level title (新手训练电台 / 未知偏移·推理局). */
  title: string
  /** Short tab label for the level switcher. */
  tab: string
  /** One-line tagline shown under headers. */
  tagline: string
  /** Shared radio-cipher GameType (structural SSOT for state + win). */
  gameType: GameType
  /** Engine Level driving state + win detection. */
  level: Level
  /** Concrete linguistic content (listener-side; never on the codebook). */
  segments: PlayableSegment[]
}

const gameType = loadGameType(gameTypeYaml)

export const PLAYABLE_LEVELS: PlayableLevel[] = [
  {
    key: '1',
    title: '新手训练电台',
    tab: '关卡一 · 新手训练',
    tagline: '偏移量已给出，照密码本解密',
    gameType,
    level: loadLevel(tutorialLevelYaml),
    segments: TUTORIAL_SEGMENTS,
  },
  {
    key: '2',
    title: '未知偏移·推理局',
    tab: '关卡二 · 未知偏移',
    tagline: '密钥只给方法，偏移量靠频率推导',
    gameType,
    level: loadLevel(deductionLevelYaml),
    segments: DEDUCTION_SEGMENTS,
  },
]

/** Resolve a level by its URL key, falling back to the first level. */
export function resolveLevel(key: string | null | undefined): PlayableLevel {
  return PLAYABLE_LEVELS.find((entry) => entry.key === key) ?? PLAYABLE_LEVELS[0]
}
