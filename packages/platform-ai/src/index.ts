/**
 * Public surface of `@amiclaw/platform-ai`.
 *
 * Exports the foundation layer (four-method session contract, three-layer
 * provider interfaces, provider-config selection, deterministic manual
 * injection) plus the runtime core: the provider factory, the handshake auth
 * seam, the testable turn-pipeline orchestration, the `VoiceSessionDO` Durable
 * Object class (required as a named export for wrangler's DO class binding),
 * and the Worker `fetch` entry as the module default.
 */

// Four-method session contract + wire types.
export type {
  SessionId,
  GameId,
  UserId,
  AudioChunk,
  ManualData,
  GameState,
  AiResponseChunk,
  CoBuildAction,
  SessionSummary,
  VoiceSessionContract,
} from './contract'

// Three-layer provider semantic interfaces.
export type {
  ChatRole,
  ChatMessage,
  LlmCompletionRequest,
  LlmCompletionChunk,
  LlmUsage,
  LlmProvider,
  SttTranscriptChunk,
  SttUsage,
  SttUsageSource,
  SttProvider,
  TtsAudioChunk,
  TtsProvider,
} from './providers/types'

// Provider selection layer.
export type {
  ProviderLayer,
  LayerSelection,
  SystemPromptConfig,
  CoBuildConfig,
  ProviderConfig,
  ResolvedConfig,
} from './provider-config'
export { resolveConfig } from './provider-config'

// Deterministic manual injection.
export type { AssembleLlmContextInput } from './manual-injection'
export { assembleLlmContext } from './manual-injection'

// Provider factory — wire a resolved config to concrete R2 adapters.
export type { ProviderEnv, SessionProviders } from './providers/factory'
export { createProviders } from './providers/factory'

// Companion voice mapping readiness — runtime fails open, launch checks fail loud.
export type {
  VendorVoiceParams,
  VoiceMappingEnv,
  VoiceMappingIssue,
  VoiceMappingReadiness,
} from './voice-id-mapping'
export {
  VOICE_ENV_BINDINGS,
  checkVoiceMappingReadiness,
  assertVoiceMappingReady,
  resolveVendorVoice,
} from './voice-id-mapping'

// Deterministic mock providers — no-credential demo / e2e harness backend.
export type {
  MockLlmProvider,
  MockLlmProviderOptions,
  MockSttProvider,
  MockSttProviderOptions,
} from './providers/mock'
export {
  createMockLlmProvider,
  createMockSttProvider,
  createMockTtsProvider,
  createMockSpeechProvider,
  MOCK_TRANSCRIPT,
} from './providers/mock'

// Handshake-time auth seam.
export type { AuthIdentity, SessionReader, SessionKvReader, AuthSeamEnv } from './auth-seam'
export {
  parseCookies,
  readSessionId,
  isDevAuthBypassEnabled,
  resolveSessionReader,
  createDevAuthBypassReader,
  createKvSessionReader,
  assertSessionOwnership,
  SocketIdentityRegistry,
  DEV_AUTH_USER_ID,
} from './auth-seam'

// Testable turn-pipeline orchestration (DO is a thin shell over this). The live
// WS transport drives the two phases separately — `runUtteranceStt` on
// `speech-start` (interim captions WHILE the player speaks) and `runReply` on
// `turn`; `runTurn` is their end-to-end composition (the buffered primitive).
export type { UsageCounters, SessionState, TurnProviders, UtteranceResult } from './turn-pipeline'
export { runTurn, runUtteranceStt, runReply, splitSentences } from './turn-pipeline'

// Session-terminal usage metering flush (the DO is a thin shell over this).
export type { UsageKvWriter, UsageRecord, SessionUsageSnapshot } from './usage-flush'

// Durable Object class (named export required for the wrangler DO binding).
export { VoiceSessionDO } from './session-do'
export type { SessionDoEnv } from './session-do'

// Worker fetch entry + its env shape.
export type { WorkerEnv } from './worker'
export { default } from './worker'
