/**
 * Provider selection layer.
 *
 * Registers, per `gameId`: that game's system-prompt config plus the chosen
 * provider/model/fallback for each of the three layers (STT / LLM / TTS).
 * Switching vendors is a config change here — game logic does not change.
 *
 * This is also the single authoritative path for the system prompt: it is
 * resolved from `gameId` here (NOT passed into `createSession`), which keeps
 * "system prompt is server-side only, never client-held" intact.
 *
 * `resolveConfig` is a pure function: a miss is an explicit error, never a
 * silent fallback to some default game.
 */

import type { GameId } from './contract'

/** The three pipeline layers a provider can be selected for. */
export type ProviderLayer = 'stt' | 'llm' | 'tts'

/**
 * Selection for one pipeline layer: which provider, which model, and the
 * ordered fallback chain to try on failure/timeout. `fallback` entries are
 * provider ids to switch to, in order; an empty array means no fallback.
 */
export interface LayerSelection {
  /** Provider id (adapter selector), e.g. 'deepseek' or 'volcengine'. */
  provider: string
  /** Concrete model id for that provider, e.g. 'deepseek-v4-flash'. */
  model: string
  /** Ordered fallback provider ids, tried left-to-right on failure. */
  fallback: string[]
}

/**
 * The system-prompt config for a game: the role + rule template the platform
 * assembles into the system message at session creation. This material is
 * server-side only.
 */
export interface SystemPromptConfig {
  /** The AI partner's role / persona for this game. */
  role: string
  /**
   * Rule-template lines describing how the partner should behave and read the
   * manual. Assembled (with `role`) into the system message by the manual
   * injection step.
   */
  ruleTemplate: string[]
}

/** Full per-game provider configuration, keyed by `gameId` in the registry. */
export interface ProviderConfig {
  systemPromptConfig: SystemPromptConfig
  llm: LayerSelection
  stt: LayerSelection
  tts: LayerSelection
}

/**
 * Resolved config returned by `resolveConfig`. Carries the `gameId` it was
 * resolved for plus the registered `ProviderConfig`, so downstream code never
 * has to re-key the registry.
 */
export interface ResolvedConfig extends ProviderConfig {
  gameId: GameId
}

/**
 * Built-in registry. Keyed by `gameId`. Adding a game = adding an entry;
 * switching a layer's vendor = editing that entry's `provider`/`model`.
 *
 * The `demo` entry backs the later demo harness: LLM = DeepSeek v4 flash
 * (OpenAI-compatible SSE), voice = Volcengine (火山), and a sample
 * manual-explainer system prompt.
 *
 * The `demo-mock` entry backs the no-credential demo / e2e harness: all three
 * layers select the deterministic `mock` provider, so the full
 * STT -> LLM -> TTS pipeline runs locally without real DeepSeek / Volcengine
 * keys. It reuses the same sample manual-explainer system prompt as `demo`.
 */
const PROVIDER_REGISTRY: Record<GameId, ProviderConfig> = {
  demo: {
    systemPromptConfig: {
      role: 'You are a calm, precise manual-explainer partner for a cooperative puzzle game. You can see the reference manual; the player can only see the device. You guide the player by voice.',
      ruleTemplate: [
        'Only rely on the manual content provided to you in context; never invent rules.',
        'Ask the player to describe what they see, then map it to the manual deterministically.',
        'Give one concrete next action at a time; confirm before moving on.',
        'Never reveal that you are reading from an injected manual subset.',
      ],
    },
    llm: {
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      fallback: ['deepseek-v4-pro'],
    },
    stt: {
      provider: 'volcengine',
      model: 'bigmodel-asr',
      fallback: [],
    },
    tts: {
      provider: 'volcengine',
      model: 'doubao-tts-2.0',
      fallback: [],
    },
  },
  'demo-mock': {
    systemPromptConfig: {
      role: 'You are a calm, precise manual-explainer partner for a cooperative puzzle game. You can see the reference manual; the player can only see the device. You guide the player by voice.',
      ruleTemplate: [
        'Only rely on the manual content provided to you in context; never invent rules.',
        'Ask the player to describe what they see, then map it to the manual deterministically.',
        'Give one concrete next action at a time; confirm before moving on.',
        'Never reveal that you are reading from an injected manual subset.',
      ],
    },
    llm: {
      provider: 'mock',
      model: 'mock-llm',
      fallback: [],
    },
    stt: {
      provider: 'mock',
      model: 'mock-stt',
      fallback: [],
    },
    tts: {
      provider: 'mock',
      model: 'mock-tts',
      fallback: [],
    },
  },
}

/** Deep-clone a layer selection so callers cannot mutate the registry. */
function cloneLayer(layer: LayerSelection): LayerSelection {
  return { provider: layer.provider, model: layer.model, fallback: [...layer.fallback] }
}

/**
 * Resolve the provider configuration for a game.
 *
 * Pure function. Throws a precise error on a miss (no silent fallback to a
 * default game) — the L2 spec requires an explicit error so a mis-registered
 * `gameId` fails loudly instead of silently running the wrong prompt/providers.
 *
 * Returns a deep copy of the registered config: the registry is the single
 * switch point for provider selection, and handing out copies keeps it from
 * being corrupted by a caller mutating a resolved object.
 */
export function resolveConfig(gameId: GameId): ResolvedConfig {
  const config = PROVIDER_REGISTRY[gameId]
  if (config === undefined) {
    const known = Object.keys(PROVIDER_REGISTRY).join(', ') || '<none>'
    throw new Error(
      `provider-config: no configuration registered for gameId "${gameId}". Known gameIds: ${known}.`
    )
  }
  return {
    gameId,
    systemPromptConfig: {
      role: config.systemPromptConfig.role,
      ruleTemplate: [...config.systemPromptConfig.ruleTemplate],
    },
    llm: cloneLayer(config.llm),
    stt: cloneLayer(config.stt),
    tts: cloneLayer(config.tts),
  }
}
