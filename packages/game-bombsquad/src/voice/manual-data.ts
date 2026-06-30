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
 * Build the `{ symbolId: description }` map for the symbol ids referenced by a
 * symbol-based module, drawn from the manual's top-level `symbols` block. Used
 * to embed each symbol's visual description alongside its module so the AI can
 * map a player's shape description (e.g. "海神叉" / "咖啡豆") back to the symbol
 * name. Returns an empty object when the manual carries no `symbols` block.
 */
function symbolDescriptionsFor(
  symbolIds: Iterable<string>,
  symbols: Manual['symbols']
): Record<string, string> {
  const out: Record<string, string> = {}
  if (!symbols) return out
  for (const id of symbolIds) {
    const entry = symbols[id]
    if (entry?.description) out[id] = entry.description
  }
  return out
}

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
 *
 * Symbol-based modules (`symbol_dial`, `keypad`) are enriched with a
 * `symbol_descriptions` map of the symbols they reference, pulled from the
 * manual's top-level `symbols` block. Without this the AI only receives the
 * lookup table of bare symbol names (psi / spiral / …) and cannot map a
 * player's visual description ("海神叉" / "咖啡豆") to the right name — the
 * `symbols` block lives at the manual root, outside any single module section,
 * so per-module injection never reached it. Embedding the referenced
 * descriptions into the module section makes them ride the existing injection.
 */
export function bombsquadManualToManualData(manual: Manual, version: string): ManualData {
  const sections: Record<string, unknown> = Object.fromEntries(Object.entries(manual.modules))

  const dial = manual.modules.symbol_dial
  if (dial?.columns) {
    const ids = new Set(dial.columns.flat())
    sections.symbol_dial = {
      ...dial,
      symbol_descriptions: symbolDescriptionsFor(ids, manual.symbols),
    }
  }

  const keypad = manual.modules.keypad
  if (keypad?.sequences) {
    const ids = new Set(keypad.sequences.flat())
    sections.keypad = { ...keypad, symbol_descriptions: symbolDescriptionsFor(ids, manual.symbols) }
  }

  return { version, sections }
}
