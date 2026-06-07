/**
 * TypeScript types for the BombSquad YAML manual schema.
 */

export interface SceneInfo {
  sceneTongueTwister: string // Chinese tongue-twister phrase, e.g. "四是四十是十"
  batteryCount: number // 1–4
  indicators: Indicator[]
}

export interface Indicator {
  label: string // e.g. "FRK", "CAR", "NSA"
  lit: boolean
}

export interface ManualMeta {
  version: string // YYYY-MM-DD
  type: 'practice' | 'daily'
}

// --- Wire module ---
export type WireColor = 'red' | 'blue' | 'yellow' | 'green' | 'white' | 'black'

export interface Wire {
  color: WireColor
}

export interface WireConfig {
  wires: Wire[] // 4 or 5 elements, ordered top-to-bottom
}

export interface WireAnswer {
  type: 'wire'
  cutPosition: number // 0-indexed position to cut
}

// --- Dial module ---
export interface DialConfig {
  dials: string[][] // 3 dials × 6 symbol ids each
  currentPositions: number[] // current index for each dial (0–5)
}

export interface DialAnswer {
  type: 'dial'
  positions: number[] // target index for each dial (0–5)
}

// --- Button module ---
export interface ButtonConfig {
  color: string // e.g. 'red', 'blue', 'yellow', 'white'
  label: string // e.g. 'ABORT', 'DETONATE', 'HOLD', 'PRESS'
  indicatorColor: string
  displayNumber: number
}

export interface ButtonAnswer {
  type: 'button'
  action: 'tap' | 'hold'
  releaseOnColor?: string // only when action === 'hold'
}

// --- Keypad module ---
export interface KeypadConfig {
  symbols: string[] // 4 symbol ids, index → visual cell per KeypadModule STAR_MAP (TL, TR, BR, BL)
}

export interface KeypadAnswer {
  type: 'keypad'
  sequence: number[] // 0-indexed positions in click order (length 4)
}

// --- Union types ---
export type ModuleConfig = WireConfig | DialConfig | ButtonConfig | KeypadConfig
export type ModuleAnswer = WireAnswer | DialAnswer | ButtonAnswer | KeypadAnswer
export type ModuleType = 'wire' | 'dial' | 'button' | 'keypad'

// --- Rule types ---
export interface WireRule {
  condition: Record<string, unknown> // flexible — matched by rule engine
  action: 'cut_wire'
  target: {
    position: 'first' | 'last' | number // 1-indexed top-down (1 = top, length = bottom); first ≡ position 1, last ≡ position length
    color?: WireColor
  }
}

export interface ButtonRule {
  condition: Record<string, unknown>
  action: { type: 'tap' } | { type: 'hold'; release_on_light: string }
}

export interface DialManualSection {
  columns: string[][] // 6 columns × 5 symbol ids each
  rule: string // human-readable description (for reference)
}

export interface KeypadManualSection {
  sequences: string[][] // 6 sequences × 6 symbol ids each
  rule: string
}

export interface ManualModules {
  wire_routing: { rules: WireRule[] }
  symbol_dial: DialManualSection
  button: { rules: ButtonRule[] }
  keypad: KeypadManualSection
}

/**
 * Per-symbol visual description injected into each rendered manual's AI
 * payload so the AI partner has a vocabulary alignment between the symbol id
 * (e.g. `psi`) and the shape the player will actually try to describe
 * ("三叉戟" / "扇子"). Under the unified-SSOT architecture the descriptions
 * live solely in `shared/symbols.ts`; the build pipeline injects them at
 * build time into the canonical AI payload that backs BOTH read paths — the
 * HTML-embedded yaml and the dist raw yaml served at `?format=yaml`. Only the
 * source yaml never carries them. The injected post-build shape still
 * conforms to this interface, so it stays here as the canonical type.
 */
export interface SymbolEntry {
  description: string
}

export interface Manual {
  meta: ManualMeta
  modules: ManualModules
  /**
   * Absent from the source yaml; the build script populates it from SYMBOLS
   * at build time onto the canonical AI payload that backs both read paths —
   * the HTML-embedded yaml and the dist raw yaml served at `?format=yaml`.
   */
  symbols?: Record<string, SymbolEntry>
  decoy_modules?: Record<string, unknown>
}

/** Minimal registry shape consumed by `validateManualSymbols`. */
export interface SymbolRegistryEntry {
  id: string
}

/**
 * Walk a manual and collect every symbol id referenced by rule data
 * (`symbol_dial.columns` + `keypad.sequences`). Used by the build-time
 * validator to enforce that every reference resolves to a known symbol in
 * the shared SYMBOLS registry.
 */
export function collectReferencedSymbols(modules: ManualModules): Set<string> {
  const seen = new Set<string>()
  for (const col of modules.symbol_dial?.columns ?? []) {
    for (const s of col) seen.add(s)
  }
  for (const seq of modules.keypad?.sequences ?? []) {
    for (const s of seq) seen.add(s)
  }
  return seen
}

/**
 * Throw if the manual references any symbol id not registered in the
 * shared SYMBOLS registry (the SSOT). Descriptions are no longer
 * authoritative on the manual side — they are injected from `registry`
 * during the manual build pipeline — so this validator's only job is to
 * confirm the manual's referenced ids are a subset of the registry's ids.
 * Pure function so tests can call it directly with parsed YAML + SYMBOLS.
 */
export function validateManualSymbols(
  manual: Manual,
  registry: readonly SymbolRegistryEntry[]
): void {
  const referenced = collectReferencedSymbols(manual.modules)
  const registered = new Set(registry.map((s) => s.id))

  const missing: string[] = []
  for (const id of referenced) {
    if (!registered.has(id)) missing.push(id)
  }
  if (missing.length > 0) {
    throw new Error(
      `Manual ${manual.meta?.version ?? '<unknown>'}: symbol id(s) referenced in modules but not registered in shared/symbols.ts SYMBOLS: ${missing.join(', ')}`
    )
  }
}
