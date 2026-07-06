/**
 * YAML loader for creation-schema GameType and Level documents.
 *
 * Parses a YAML document and performs minimal structural narrowing (required
 * top-level fields present) with clear errors. It deliberately does NOT
 * validate semantics — enum membership, cross-references, budgets, and all
 * co-play-form floor checks belong to the validator (a later round).
 *
 * Document form follows the spec's worked examples: the document root is a
 * mapping whose single key is `GameType:` or `Level:`, wrapping the payload.
 * Extra sibling root keys are rejected.
 */

import { load as parseYaml, YAMLException } from 'js-yaml'
import type { GameType, Level } from './types'

/** Thrown for any structural problem while loading a schema document. */
export class SchemaLoadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SchemaLoadError'
  }
}

const GAME_TYPE_REQUIRED_FIELDS = [
  'id',
  'version',
  'display_name',
  'description',
  'co_play_form',
  'element_archetypes',
  'rule_templates',
  'win_condition_type',
  'difficulty_budget',
  'action_registry',
  'communication_budget',
  'solver_strategy',
  'solver_timeout_ms',
] as const
// information_partition_template is intentionally not required: co-play forms
// other than hidden_info_coop may simplify or omit it (spec Mechanism 1).

const LEVEL_REQUIRED_FIELDS = [
  'metadata',
  'difficulty',
  'communication_estimate',
  'elements',
  'rules',
  'information_partition',
  'win_condition',
] as const

const LEVEL_METADATA_REQUIRED_FIELDS = [
  'id',
  'game_type',
  'game_type_version',
  'title',
  'author',
  'created_at',
] as const

function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function describeValue(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'a sequence'
  return `a ${typeof value}`
}

function unwrapDocument(yamlText: string, rootKey: 'GameType' | 'Level'): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = parseYaml(yamlText)
  } catch (err) {
    const detail = err instanceof YAMLException ? err.message : String(err)
    throw new SchemaLoadError(`Invalid YAML: ${detail}`)
  }
  if (!isMapping(parsed)) {
    throw new SchemaLoadError(
      `Expected a YAML mapping with a top-level "${rootKey}" key, got ${describeValue(parsed)}`
    )
  }
  const rootKeys = Object.keys(parsed)
  const payload = parsed[rootKey]
  if (payload === undefined) {
    throw new SchemaLoadError(
      `Missing top-level "${rootKey}" key; document root keys: ${rootKeys.join(', ') || '(none)'}`
    )
  }
  if (rootKeys.length !== 1) {
    const extras = rootKeys.filter((key) => key !== rootKey)
    throw new SchemaLoadError(
      `Expected "${rootKey}" to be the only root key, found extra root key(s): ${extras.join(', ')}`
    )
  }
  if (!isMapping(payload)) {
    throw new SchemaLoadError(`"${rootKey}" must be a mapping, got ${describeValue(payload)}`)
  }
  return payload
}

function assertRequiredFields(
  doc: Record<string, unknown>,
  fields: readonly string[],
  context: string
): void {
  const missing = fields.filter((field) => doc[field] === undefined || doc[field] === null)
  if (missing.length > 0) {
    throw new SchemaLoadError(
      `${context} document is missing required field(s): ${missing.join(', ')}`
    )
  }
}

/** Parse a GameType YAML document and narrow it structurally. */
export function loadGameType(yamlText: string): GameType {
  const doc = unwrapDocument(yamlText, 'GameType')
  assertRequiredFields(doc, GAME_TYPE_REQUIRED_FIELDS, 'GameType')
  return doc as unknown as GameType
}

/** Parse a Level YAML document and narrow it structurally. */
export function loadLevel(yamlText: string): Level {
  const doc = unwrapDocument(yamlText, 'Level')
  assertRequiredFields(doc, LEVEL_REQUIRED_FIELDS, 'Level')
  const metadata = doc.metadata
  if (!isMapping(metadata)) {
    throw new SchemaLoadError(`Level "metadata" must be a mapping, got ${describeValue(metadata)}`)
  }
  assertRequiredFields(metadata, LEVEL_METADATA_REQUIRED_FIELDS, 'Level metadata')
  return doc as unknown as Level
}
