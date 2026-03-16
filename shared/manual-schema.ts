/**
 * TypeScript types for the BombSquad YAML manual schema.
 */

export interface SceneInfo {
  serialNumber: string      // 6-char alphanumeric, e.g. "A7K3B9"
  batteryCount: number      // 1–4
  indicators: Indicator[]
}

export interface Indicator {
  label: string             // e.g. "FRK", "CAR", "NSA"
  lit: boolean
}

export interface ManualMeta {
  version: string           // YYYY-MM-DD
  type: 'practice' | 'daily'
}

// --- Wire module ---
export type WireColor = 'red' | 'blue' | 'yellow' | 'green' | 'white' | 'black'

export interface Wire {
  color: WireColor
  hasStripe: boolean
  stripeColor?: WireColor
}

export interface WireConfig {
  wires: Wire[]   // 4 or 5 elements, ordered top-to-bottom
}

export interface WireAnswer {
  type: 'wire'
  cutPosition: number   // 0-indexed position to cut
}

// --- Dial module ---
export interface DialConfig {
  dials: string[][]   // 3 dials × 6 symbol ids each
  currentPositions: number[]   // current index for each dial (0–5)
}

export interface DialAnswer {
  type: 'dial'
  positions: number[]   // target index for each dial (0–5)
}

// --- Button module ---
export interface ButtonConfig {
  color: string        // e.g. 'red', 'blue', 'yellow', 'white'
  label: string        // e.g. 'ABORT', 'DETONATE', 'HOLD', 'PRESS'
  indicatorColor: string
  displayNumber: number
}

export interface ButtonAnswer {
  type: 'button'
  action: 'tap' | 'hold'
  releaseOnColor?: string   // only when action === 'hold'
}

// --- Keypad module ---
export interface KeypadConfig {
  symbols: string[]   // 4 symbol ids in the 2×2 grid (row-major: TL, TR, BL, BR)
}

export interface KeypadAnswer {
  type: 'keypad'
  sequence: number[]   // 0-indexed positions in click order (length 4)
}

// --- Union types ---
export type ModuleConfig = WireConfig | DialConfig | ButtonConfig | KeypadConfig
export type ModuleAnswer = WireAnswer | DialAnswer | ButtonAnswer | KeypadAnswer
export type ModuleType = 'wire' | 'dial' | 'button' | 'keypad'

// --- Rule types ---
export interface WireRule {
  condition: Record<string, unknown>   // flexible — matched by rule engine
  action: 'cut_wire'
  target: {
    position: 'first' | 'last' | number   // 0-indexed number or keyword
    color?: WireColor
  }
}

export interface ButtonRule {
  condition: Record<string, unknown>
  action: { type: 'tap' } | { type: 'hold'; release_on_light: string }
}

export interface DialManualSection {
  columns: string[][]   // 6 columns × 6 symbol ids each
  rule: string          // human-readable description (for reference)
}

export interface KeypadManualSection {
  sequences: string[][]   // 6 sequences × 6 symbol ids each
  rule: string
}

export interface ManualModules {
  wire_routing: { rules: WireRule[] }
  symbol_dial: DialManualSection
  button: { rules: ButtonRule[] }
  keypad: KeypadManualSection
}

export interface Manual {
  meta: ManualMeta
  modules: ManualModules
  decoy_modules?: Record<string, unknown>
}
