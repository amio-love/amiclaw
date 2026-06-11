/**
 * Adapter: the platform's streaming `LlmProvider` abstraction -> the
 * companion-memory `DistillLlm` one-shot seam.
 *
 * The consolidation job reuses the SAME provider layer as the voice pipeline
 * (one OpenAI-compatible adapter family), on the text path: drain the
 * streamed completion into one string. No second vendor integration.
 */

import type { DistillLlm } from '../../companion-memory/src/distill'
import { createDeepSeekLlmProvider } from './providers/deepseek'
import type { LlmProvider } from './providers/types'

/** Model used for consolidation distillation (text path, cheap + fast tier). */
const CONSOLIDATION_LLM_MODEL = 'deepseek-v4-flash'

/** Wrap a streaming `LlmProvider` into the one-shot `DistillLlm` seam. */
export function createDistillLlm(provider: LlmProvider, model: string): DistillLlm {
  return {
    async complete(prompt: string): Promise<string> {
      let text = ''
      for await (const chunk of provider.streamCompletion({
        model,
        messages: [{ role: 'user', content: prompt }],
      })) {
        text += chunk.content
        if (chunk.done) break
      }
      return text
    },
  }
}

/** Env slice the consolidation LLM needs (same secrets as the voice path). */
export interface ConsolidationLlmEnv {
  DEEPSEEK_API_KEY?: string
  DEEPSEEK_BASE_URL?: string
}

/**
 * Build the consolidation LLM from env, or `null` when no key is configured —
 * the job then degrades to settlement-facts-only consolidation (pinned
 * degradation semantics; never a hard failure).
 */
export function createConsolidationLlm(env: ConsolidationLlmEnv): DistillLlm | null {
  if (env.DEEPSEEK_API_KEY === undefined || env.DEEPSEEK_API_KEY === '') return null
  const provider = createDeepSeekLlmProvider({
    apiKey: env.DEEPSEEK_API_KEY,
    baseUrl: env.DEEPSEEK_BASE_URL,
    model: CONSOLIDATION_LLM_MODEL,
  })
  return createDistillLlm(provider, CONSOLIDATION_LLM_MODEL)
}
