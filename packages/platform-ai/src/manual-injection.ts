/**
 * Deterministic manual injection.
 *
 * Pure function `assembleLlmContext` builds the OpenAI-compatible `messages[]`
 * for one turn:
 *   - The role + rule template (from `provider-config`'s `systemPromptConfig`)
 *     go into the system message.
 *   - The manual subset selected by game state is injected directly into the
 *     context, deterministically — the platform decides which manual sections
 *     are relevant, rather than relying on the model's function-calling to go
 *     fetch them.
 *
 * Determinism is the point: given the same config, manual, and game state, the
 * assembled messages are byte-identical. No model in the loop here.
 */

import type { ManualData } from './contract'
import type { ChatMessage } from './providers/types'
import type { SystemPromptConfig } from './provider-config'

/**
 * Game state that drives manual-subset selection. `relevantSections` is the
 * ordered list of manual section ids the platform deems relevant for the
 * current turn (e.g. the current module/phase). The game owns how it derives
 * this list; injection only consumes it.
 */
export interface GameState {
  /** Ordered manual section ids to inject for this turn. */
  relevantSections: string[]
}

/** Input to `assembleLlmContext`. */
export interface AssembleLlmContextInput {
  systemPromptConfig: SystemPromptConfig
  manualData: ManualData
  gameState: GameState
}

/**
 * Build the system-message text from a game's system-prompt config: the role
 * line followed by the rule template, one rule per line.
 */
function buildSystemPrompt(config: SystemPromptConfig): string {
  if (config.ruleTemplate.length === 0) {
    return config.role
  }
  const rules = config.ruleTemplate.map((rule) => `- ${rule}`).join('\n')
  return `${config.role}\n\nRules:\n${rules}`
}

/**
 * Serialize the selected manual subset into a single injected block. Only the
 * sections named in `gameState.relevantSections` that actually exist in the
 * manual are included, in the order requested. Selection is deterministic and
 * silent-drops unknown ids (the game owns its own id space; an unknown id just
 * contributes nothing rather than throwing — a missing optional section is a
 * normal game-state condition, not an error).
 */
function buildManualInjection(manualData: ManualData, gameState: GameState): string {
  const blocks: string[] = []
  for (const sectionId of gameState.relevantSections) {
    if (Object.prototype.hasOwnProperty.call(manualData.sections, sectionId)) {
      const value = manualData.sections[sectionId]
      blocks.push(`### ${sectionId}\n${JSON.stringify(value, null, 2)}`)
    }
  }
  const header = `Manual (version ${manualData.version}) — relevant sections for the current state:`
  if (blocks.length === 0) {
    return `${header}\n(no relevant manual sections for the current state)`
  }
  return `${header}\n\n${blocks.join('\n\n')}`
}

/**
 * Assemble the OpenAI-compatible message array for one turn.
 *
 * Returns exactly two messages:
 *   1. a `system` message carrying role + rules + the injected manual subset
 *      (all server-side material — it never leaves the server boundary), and
 *   2. nothing else here: conversation history / the player's transcribed turn
 *      are appended by the turn pipeline downstream. Keeping this function to
 *      the deterministic, server-side-only portion makes it pure and testable,
 *      and guarantees the prompt material lives only in the system message.
 *
 * Pure: no I/O, no clock, no randomness.
 */
export function assembleLlmContext(input: AssembleLlmContextInput): ChatMessage[] {
  const { systemPromptConfig, manualData, gameState } = input
  const systemPrompt = buildSystemPrompt(systemPromptConfig)
  const manualInjection = buildManualInjection(manualData, gameState)
  return [
    {
      role: 'system',
      content: `${systemPrompt}\n\n${manualInjection}`,
    },
  ]
}
