/**
 * PLAYER-LAYER visual/display data (locked constraint §1). The engine stays a
 * generic state machine keyed by ASCII enum values (`species: 'orchid'`,
 * `health: 'wilting'`, …); this module is the ONLY place those enums become a
 * sprite, a Chinese label, a tint, or a size. The engine never learns a sprite
 * exists. Everything here is keyed by the engine's ASCII values and is safe to
 * evolve without touching @amiclaw/creation.
 */
import type { GameType } from '@amiclaw/creation'

/** species enum → glyph + Chinese label. */
export const SPECIES_DISPLAY: Record<string, { label: string; sprite: string }> = {
  fern: { label: '蕨类', sprite: '🌿' },
  succulent: { label: '多肉', sprite: '🌵' },
  orchid: { label: '兰花', sprite: '🌷' },
  moss: { label: '苔藓', sprite: '🍀' },
  vine: { label: '藤蔓', sprite: '🍃' },
}

/** health enum → Chinese label (worst → best). */
export const HEALTH_LABEL: Record<string, string> = {
  dead: '枯死',
  critical: '垂危',
  wilting: '枯萎',
  stable: '稳定',
  thriving: '茁壮',
}

/** growth_stage enum → Chinese label. */
export const GROWTH_LABEL: Record<string, string> = {
  seedling: '幼苗',
  juvenile: '成株',
  mature: '成熟',
  flowering: '开花',
}

/** effective_light enum → Chinese label. */
export const LIGHT_LABEL: Record<string, string> = {
  full_sun: '全光',
  partial_shade: '半荫',
  full_shade: '全荫',
}

/** environment zone_id → Chinese label. */
export const ZONE_LABEL: Record<string, string> = {
  north: '北区',
  center: '中区',
  south: '南区',
}

export function speciesLabel(species: string): string {
  return SPECIES_DISPLAY[species]?.label ?? species
}

/** The glyph a pot renders: death and flowering override the species glyph. */
export function plantSprite(species: string, health: string, growthStage: string): string {
  if (health === 'dead') return '🥀'
  if (growthStage === 'flowering') return '🌸'
  return SPECIES_DISPLAY[species]?.sprite ?? '🌱'
}

/**
 * Ordered value list for a plant state, read from the loaded GameType archetype
 * rather than hardcoded — so a rank comparison (did health improve?) tracks the
 * engine's declared order (worst → best) instead of duplicating it here.
 */
export function plantStateOrder(gameType: GameType, stateName: string): string[] {
  const plant = gameType.element_archetypes.find((a) => a.id === 'plant')
  return plant?.states?.find((s) => s.name === stateName)?.values ?? []
}

/** Signed rank delta of `after` vs `before` within an ordered enum. */
export function rankDelta(order: string[], before: string, after: string): number {
  return order.indexOf(after) - order.indexOf(before)
}
