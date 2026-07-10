/**
 * Botanical bridge into the platform-ai voice-session contract's `ManualData`:
 * render the manual (R3) and project it to the addressable-sections shape the
 * AI botanist is grounded on. Pure — no I/O, no React — so the voice hook/UI
 * build on a unit-tested seam.
 */
import type { GameType, Level } from '@amiclaw/creation'
import type { ManualData } from '@amiclaw/platform-ai/contract'
import { renderBotanicalManual, toManualData } from '@/manual/render-manual'

/** Build the per-level `ManualData` the botanist session is created with. */
export function buildBotanicalManualData(gameType: GameType, level: Level): ManualData {
  return toManualData(renderBotanicalManual(gameType, level))
}
