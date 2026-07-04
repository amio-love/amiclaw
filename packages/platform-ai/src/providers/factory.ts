/**
 * Provider factory — wire a `ResolvedConfig` to concrete R2 adapters.
 *
 * `resolveConfig(gameId)` (see `provider-config.ts`) yields a `ResolvedConfig`
 * whose three `LayerSelection`s name a `provider` id + `model` per layer. This
 * factory routes each provider id to the matching R2 adapter factory and pulls
 * credentials *only* from the Worker `env` — never from config, never from the
 * wire. An unknown provider id throws a precise error so a mis-registered
 * config fails loudly rather than silently running the wrong vendor.
 *
 * The Volcengine speech adapter is the shared voice layer: one
 * `createVolcengineSpeechProvider` call backs BOTH the STT and TTS slots when
 * both layers select `volcengine`. We do not build it twice.
 */

import type { LlmProvider, SttProvider, TtsProvider } from './types'
import type { ResolvedConfig } from '../provider-config'
import type { VoiceMappingEnv } from '../voice-id-mapping'
import { createDeepSeekLlmProvider } from './deepseek'
import { createVolcengineSpeechProvider } from './volcengine'
import { createMockLlmProvider, createMockSpeechProvider } from './mock'

/** Provider id selecting the DeepSeek (OpenAI-compatible) LLM adapter. */
const PROVIDER_DEEPSEEK = 'deepseek'
/** Provider id selecting the shared Volcengine (火山) speech adapter. */
const PROVIDER_VOLCENGINE = 'volcengine'
/**
 * Provider id selecting the deterministic mock adapters (no network, no
 * credentials). Used by the demo harness and e2e scenarios so the full pipeline
 * runs without real provider keys. Valid on all three layers.
 */
const PROVIDER_MOCK = 'mock'

/**
 * Server-side credential surface the factory reads. Mirrors the Worker env
 * bindings declared in `wrangler.toml`; every field is optional here so the
 * factory can throw a precise "missing credential" error for the specific
 * vendor a config actually selects, rather than failing on an unrelated one.
 */
export interface ProviderEnv extends VoiceMappingEnv {
  /** DeepSeek API key, server-side only. */
  DEEPSEEK_API_KEY?: string
  /** Optional DeepSeek base URL override. */
  DEEPSEEK_BASE_URL?: string
  /**
   * Volcengine (火山) console API key, sent as the single `X-Api-Key` header.
   * New-console-auth credential granting the Doubao 2.0 speech stack; replaces
   * the legacy `VOLC_APP_ID` + `VOLC_ACCESS_KEY` pair (no longer read).
   */
  VOLC_API_KEY?: string
  /** Optional Volcengine ASR resource id override. */
  VOLC_STT_RESOURCE_ID?: string
  /** Optional Volcengine TTS resource id override. */
  VOLC_TTS_RESOURCE_ID?: string
}

/** The three wired provider instances for one session. */
export interface SessionProviders {
  stt: SttProvider
  llm: LlmProvider
  tts: TtsProvider
}

/**
 * Per-session voice overrides resolved at assembly (companion voice wiring).
 * `ttsSpeaker` is the vendor voice token resolved from the companion's
 * platform-neutral `voice_id` (see `voice-id-mapping.ts`); `undefined` keeps
 * the adapter's default voice — the exact pre-companion behavior.
 */
export interface SessionVoiceOverrides {
  ttsSpeaker?: string
}

/** Throw a precise error for a credential the selected vendor requires. */
function requireCredential(value: string | undefined, name: string, providerId: string): string {
  if (value === undefined || value === '') {
    throw new Error(`provider-factory: ${providerId} provider selected but env.${name} is not set`)
  }
  return value
}

/** Build the LLM provider for the resolved LLM layer selection. */
function createLlmProvider(resolved: ResolvedConfig, env: ProviderEnv): LlmProvider {
  const { provider, model } = resolved.llm
  switch (provider) {
    case PROVIDER_MOCK:
      return createMockLlmProvider()
    case PROVIDER_DEEPSEEK:
      return createDeepSeekLlmProvider({
        apiKey: requireCredential(env.DEEPSEEK_API_KEY, 'DEEPSEEK_API_KEY', provider),
        baseUrl: env.DEEPSEEK_BASE_URL,
        model,
      })
    default:
      throw new Error(
        `provider-factory: unknown llm provider id "${provider}" (known: ${PROVIDER_MOCK}, ${PROVIDER_DEEPSEEK})`
      )
  }
}

/**
 * Build the shared Volcengine speech pair once. Both the STT and TTS layers map
 * to this single instance when they select `volcengine`; building it once keeps
 * the voice layer shared (one socket pair per modality, one adapter).
 *
 * The resolved STT and TTS model ids from `provider-config` are threaded in so
 * the config's "each layer's model is swappable" contract actually reaches the
 * wire: `sttModel` becomes the ASR `request.model_name`, `ttsModel` the Doubao
 * TTS `req_params.model` when it is a non-empty concrete value. The `demo` TTS
 * model is the empty-string sentinel ("use the resource-id default model"), so
 * this passthrough omits `req_params.model` by default — the mechanism stays
 * available for a concrete deploy-time-confirmed token without guessing one onto
 * the wire now. Without this passthrough the adapter would fall back to its
 * built-in defaults and the config model would be a silent no-op (the F-K bug,
 * for the STT side and any future concrete TTS token). The shared pair is built
 * from BOTH layers' models, which is correct: when
 * both voice slots select `volcengine` the spec already binds them to one shared
 * voice instance, and a single Volcengine config registers STT + TTS together.
 */
function createVolcengineSpeech(
  resolved: ResolvedConfig,
  env: ProviderEnv,
  voice?: SessionVoiceOverrides
): { stt: SttProvider; tts: TtsProvider } {
  return createVolcengineSpeechProvider({
    apiKey: requireCredential(env.VOLC_API_KEY, 'VOLC_API_KEY', PROVIDER_VOLCENGINE),
    sttResourceId: env.VOLC_STT_RESOURCE_ID,
    ttsResourceId: env.VOLC_TTS_RESOURCE_ID,
    sttModel: resolved.stt.model,
    ttsModel: resolved.tts.model,
    // Per-session companion voice: an `undefined` speaker falls through to the
    // adapter's `DEFAULT_TTS_SPEAKER`, so a session with no companion (or a
    // degraded voice resolution) is byte-identical to the pre-companion wire.
    ttsSpeaker: voice?.ttsSpeaker,
  })
}

/**
 * Wire all three provider layers from a resolved config + the Worker env.
 *
 * Routes each `LayerSelection.provider` id to its R2 adapter factory. When both
 * the STT and TTS layers select `volcengine`, the same shared speech instance
 * backs both. An unknown provider id on any layer throws. `voice` carries the
 * per-session overrides resolved at assembly (companion voice); omitted, the
 * wiring is identical to the pre-companion factory.
 */
export function createProviders(
  resolved: ResolvedConfig,
  env: ProviderEnv,
  voice?: SessionVoiceOverrides
): SessionProviders {
  const llm = createLlmProvider(resolved, env)

  // Build each shared speech pair at most once, lazily, only if a voice layer
  // actually selects it. Both the mock and Volcengine voice layers are shared
  // STT+TTS instances — one build backs both slots.
  let volcengine: { stt: SttProvider; tts: TtsProvider } | undefined
  const getVolcengine = (): { stt: SttProvider; tts: TtsProvider } => {
    if (volcengine === undefined) volcengine = createVolcengineSpeech(resolved, env, voice)
    return volcengine
  }
  let mock: { stt: SttProvider; tts: TtsProvider } | undefined
  const getMock = (): { stt: SttProvider; tts: TtsProvider } => {
    if (mock === undefined) mock = createMockSpeechProvider()
    return mock
  }

  const knownSpeech = `${PROVIDER_MOCK}, ${PROVIDER_VOLCENGINE}`

  let stt: SttProvider
  switch (resolved.stt.provider) {
    case PROVIDER_MOCK:
      stt = getMock().stt
      break
    case PROVIDER_VOLCENGINE:
      stt = getVolcengine().stt
      break
    default:
      throw new Error(
        `provider-factory: unknown stt provider id "${resolved.stt.provider}" (known: ${knownSpeech})`
      )
  }

  let tts: TtsProvider
  switch (resolved.tts.provider) {
    case PROVIDER_MOCK:
      tts = getMock().tts
      break
    case PROVIDER_VOLCENGINE:
      tts = getVolcengine().tts
      break
    default:
      throw new Error(
        `provider-factory: unknown tts provider id "${resolved.tts.provider}" (known: ${knownSpeech})`
      )
  }

  return { stt, llm, tts }
}
