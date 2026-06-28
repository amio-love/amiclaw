/**
 * Pure transformers bridging BombSquad's loaded manual + module model into the
 * game-agnostic `@amiclaw/platform-ai` voice-session contract.
 *
 * Both functions are pure — no I/O, no React, no side effects — so the voice
 * hook/UI rounds can build on a unit-tested seam. The platform-ai types are
 * imported type-only from the `./contract` subpath, which carries the wire
 * shapes only (no Durable Object / agents / provider runtime), keeping the
 * frontend bundle free of Worker code.
 */

import type { Manual } from '@shared/manual-schema'
import type { ManualData } from '@amiclaw/platform-ai/contract'
import type { ModuleKind } from '@/store/game-context'

/**
 * Map a game `ModuleKind` to the manual section id(s) it grounds on. Section
 * ids match the real manual data keys under `Manual.modules`
 * (`wire_routing` / `symbol_dial` / `button` / `keypad`) and the platform-ai
 * `GameState.relevantSections` contract. Typed as `Record<ModuleKind, ...>` so
 * a new `ModuleKind` variant fails the build until its mapping is added.
 */
const MODULE_KIND_TO_SECTION_IDS: Record<ModuleKind, readonly string[]> = {
  wire: ['wire_routing'],
  dial: ['symbol_dial'],
  button: ['button'],
  keypad: ['keypad'],
}

/**
 * Resolve the manual section id(s) the platform should inject for the given
 * module. Feeds `gameState.relevantSections` so the platform deterministically
 * injects the current module's manual subset. Returns a fresh array so callers
 * cannot mutate the shared mapping.
 */
export function moduleKindToRelevantSections(kind: ModuleKind): string[] {
  return [...MODULE_KIND_TO_SECTION_IDS[kind]]
}

/**
 * Map a loaded BombSquad `Manual` into the platform-ai `ManualData` shape. The
 * `sections` record is keyed by the manual's real module-section ids; each
 * value is that module's manual content (rules / columns / sequences).
 *
 * Only the real `modules` are included — `decoy_modules` are intentionally
 * dropped. The AI grounds on real module rules, and `relevantSections` only
 * ever references real modules (see `moduleKindToRelevantSections`), so decoys
 * would only be unreachable injection weight.
 */
export function bombsquadManualToManualData(manual: Manual, version: string): ManualData {
  return {
    version,
    sections: Object.fromEntries(Object.entries(manual.modules)),
  }
}
