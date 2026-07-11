/**
 * The Sound Garden GameType — loaded verbatim from the creation package's
 * validated fixture (`@amiclaw/creation/fixtures/sound-garden/game-type.yaml`)
 * so the probe uses the exact same vocabulary, action registry, and
 * relation_scores the engine and validator were designed against. Zero drift:
 * this is a re-use, not a re-declaration.
 *
 * Levels supply their OWN harmony matrix + win threshold (see levels.ts);
 * only the GameType-level vocabulary and relation_scores come from here.
 */

import { loadGameType } from '@amiclaw/creation'
import type { GameType } from '@amiclaw/creation'
import gameTypeYaml from '../../../creation/fixtures/sound-garden/game-type.yaml?raw'

export const SOUND_GARDEN_GAME_TYPE: GameType = loadGameType(gameTypeYaml)
