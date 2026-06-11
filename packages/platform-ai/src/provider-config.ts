/**
 * Provider selection layer.
 *
 * Registers, per `gameId`: that game's system-prompt config plus the chosen
 * provider + model for each of the three layers (STT / LLM / TTS). Switching
 * vendors is a config change here — game logic does not change.
 *
 * This is also the single authoritative path for the system prompt: it is
 * resolved from `gameId` here (NOT passed into `createSession`), which keeps
 * "system prompt is server-side only, never client-held" intact.
 *
 * `resolveConfig` is a pure function: a miss is an explicit error, never a
 * silent fallback to some default game.
 *
 * FOLLOWUP — provider timeout + fallback chain (NOT implemented in v1): the L2
 * spec (`docs/architecture/arch-component-platform-ai-interface.md` §L3 验收目标)
 * lists per-layer provider timeouts and a `provider-config`-defined fallback
 * order as explicit L3 acceptance targets, to be landed against real CF-edge +
 * real-provider measurements. v1 deliberately ships provider + model switching
 * only (the wired "vendor is swappable" core) and does NOT carry an unwired
 * `fallback` config field: `createProviders` builds one provider per layer and
 * `runTurn` calls each once and fails loud on first error, so a `fallback` array
 * would have been a promised-but-unimplemented capability. It is re-added when
 * the timeout + fallback followup is actually implemented and wired.
 */

import type { GameId } from './contract'

/** The three pipeline layers a provider can be selected for. */
export type ProviderLayer = 'stt' | 'llm' | 'tts'

/**
 * Selection for one pipeline layer: which provider and which model. Switching a
 * vendor is an edit to these two fields (the wired "vendor is swappable" core).
 *
 * No `fallback` field: a provider timeout + fallback chain is a deferred L3
 * followup (see the file docblock) and v1 does not carry unwired config for it.
 */
export interface LayerSelection {
  /** Provider id (adapter selector), e.g. 'deepseek' or 'volcengine'. */
  provider: string
  /** Concrete model id for that provider, e.g. 'deepseek-v4-flash'. */
  model: string
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
    },
    stt: {
      // `bigmodel` is the only `model_name` the Volcengine v3 streaming ASR
      // endpoint (`/api/v3/sauc/bigmodel`) accepts — it is passed verbatim as the
      // wire `request.model_name` (the factory threads it through; see F-K). A
      // non-wire alias like `bigmodel-asr` would now produce an illegal model id
      // and fail the turn. Doc: https://www.volcengine.com/docs/6561/1354869
      provider: 'volcengine',
      model: 'bigmodel',
    },
    tts: {
      // Empty string = the "use the resource-id default model" sentinel: the
      // Doubao TTS 2.0 model is bound by the paired resource id
      // (`X-Api-Resource-Id: volc.service_type.10029`, the adapter's
      // `DEFAULT_TTS_RESOURCE_ID`), and `req_params.model` is left OUT of the
      // `StartSession` frame by default. This aligns with Volcengine's own
      // first-party speech clients (`volcengine/ai-app-lab` and the bigmodel
      // ASR/TTS clients), which omit `req_params.model` and let the resource id
      // pick the model. An empty model here makes the factory's F-K passthrough a
      // no-op for the wire (the adapter only attaches `req_params.model` when the
      // threaded model is non-empty), so no model token is guessed onto the wire —
      // sending a wrong token is rejected by the server, sending none is the safe
      // default. The concrete `req_params.model` wire value (`seed-tts-2.0-standard`
      // / `-expressive` vs omitted) is a DEPLOY-TIME verification item: once the
      // real endpoint confirms the exact token, set it here and the same F-K
      // passthrough carries it onto the wire — the mechanism stays available, only
      // the default is "omit". Doc: https://www.volcengine.com/docs/6561/1329505
      provider: 'volcengine',
      model: '',
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
    },
    stt: {
      provider: 'mock',
      model: 'mock-stt',
    },
    tts: {
      provider: 'mock',
      model: 'mock-tts',
    },
  },
}

/** Deep-clone a layer selection so callers cannot mutate the registry. */
function cloneLayer(layer: LayerSelection): LayerSelection {
  return { provider: layer.provider, model: layer.model }
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
