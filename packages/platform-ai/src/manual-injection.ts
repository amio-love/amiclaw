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
 *   - The companion context resolved at session assembly (optional fourth
 *     input) is injected the same way — deterministic, server-side, appended
 *     after the manual block; absent, the prompt is byte-identical to the
 *     pre-companion shape.
 *
 * Determinism is the point: given the same config, manual, game state, and
 * (optional) companion context, the assembled messages are byte-identical. No
 * model in the loop here.
 */

import type { CompanionContext } from '../../companion-memory/src/types'
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
  /**
   * Companion context resolved at session assembly (companion-memory
   * resolver). Optional: absent for memory-less sessions (no companion set
   * up, resolver degraded, mode① — nothing is injected and the prompt is
   * byte-identical to the pre-companion shape). Injected ISOMORPHIC to the
   * manual: deterministically, server-side, never via model function-calling.
   */
  companionContext?: CompanionContext
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
 * Serialize the companion context into a single injected block (the memory
 * counterpart of `buildManualInjection` — same deterministic, server-side
 * shape). The identity lines always inject when a companion exists; the
 * claims / episodes sections are included only when non-empty, so a fresh
 * companion with no memories still knows its own name.
 */
function buildCompanionInjection(context: CompanionContext): string {
  const lines: string[] = ['Companion memory (platform-injected):']
  lines.push(`Your name is ${context.companion.name}.`)
  if (context.companion.address_style.length > 0) {
    lines.push(`Address the player as "${context.companion.address_style}".`)
  }
  if (context.claims.length > 0) {
    lines.push('What you understand about the player:')
    for (const claim of context.claims) {
      lines.push(`- [${claim.dimension}] ${claim.claim}`)
    }
  }
  if (context.episodes.length > 0) {
    lines.push('Shared memories you may naturally reference:')
    for (const episode of context.episodes) {
      lines.push(
        `- (${episode.occurred_at} · ${episode.game_id}) ${episode.title}: ${episode.narrative}`
      )
    }
  }
  return lines.join('\n')
}

/**
 * Assemble the OpenAI-compatible message array for one turn.
 *
 * Returns exactly two messages:
 *   1. a `system` message carrying role + rules + the injected manual subset +
 *      (when a companion context is present) the companion memory block
 *      (all server-side material — it never leaves the server boundary), and
 *   2. nothing else here: conversation history / the player's transcribed turn
 *      are appended by the turn pipeline downstream. Keeping this function to
 *      the deterministic, server-side-only portion makes it pure and testable,
 *      and guarantees the prompt material lives only in the system message.
 *
 * Pure: no I/O, no clock, no randomness.
 */
export function assembleLlmContext(input: AssembleLlmContextInput): ChatMessage[] {
  const { systemPromptConfig, manualData, gameState, companionContext } = input
  const systemPrompt = buildSystemPrompt(systemPromptConfig)
  const manualInjection = buildManualInjection(manualData, gameState)
  const blocks = [systemPrompt, manualInjection]
  if (companionContext !== undefined) {
    blocks.push(buildCompanionInjection(companionContext))
  }
  return [
    {
      role: 'system',
      content: blocks.join('\n\n'),
    },
  ]
}
