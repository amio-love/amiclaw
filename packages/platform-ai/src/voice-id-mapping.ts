/**
 * Platform-neutral `voice_id` -> vendor voice-parameter mapping (companion
 * memory L2 §Mechanism Variant 3, continuity across vendors).
 *
 * Lives on the provider-config plane: the companion profile stores ONLY the
 * platform-neutral id (`companion-warm` / ...); the concrete vendor token is
 * resolved server-side from deploy configuration at session assembly
 * (`session-assembly.ts` threads it into the TTS provider as the speaker
 * override). Switching the TTS vendor or model = editing deploy configuration
 * and this resolver plane — the companion profile is never touched.
 *
 * Resolution is TOTAL, mirroring the companion-context resolver's degrade
 * semantics: an unknown id or an unfilled deploy-time placeholder resolves to
 * `undefined` with a `console.warn`, and the session keeps the provider's
 * default voice. A voice-mapping gap must never fail session creation — the
 * companion's voice is identity, but a degraded voice beats no session.
 *
 * Volcengine `voice_type` tokens are deploy configuration, not source code.
 * The resolver reads `VOLC_TTS_VOICE_COMPANION_*` env vars; no guessed token is
 * committed or sent on the wire. Runtime resolution stays fail-open for player
 * experience, while `assertVoiceMappingReady` is fail-loud for launch checks.
 */

import { PLATFORM_VOICE_IDS, type PlatformVoiceId } from '../../companion-memory/src/types'

/** Vendor-facing voice parameters for one platform voice id. */
export interface VendorVoiceParams {
  /** Concrete Volcengine TTS `voice_type` token. */
  volcengineVoiceType: string
}

/** Deploy-time environment variables carrying real Volcengine voice tokens. */
export interface VoiceMappingEnv {
  VOLC_TTS_VOICE_COMPANION_WARM?: string
  VOLC_TTS_VOICE_COMPANION_BRIGHT?: string
  VOLC_TTS_VOICE_COMPANION_CALM?: string
}

/**
 * Env var names keyed by the platform-neutral voice catalog. Exported so tests
 * and runbooks can assert every platform voice id has a deploy variable.
 */
export const VOICE_ENV_BINDINGS: Record<PlatformVoiceId, keyof VoiceMappingEnv> = {
  'companion-warm': 'VOLC_TTS_VOICE_COMPANION_WARM',
  'companion-bright': 'VOLC_TTS_VOICE_COMPANION_BRIGHT',
  'companion-calm': 'VOLC_TTS_VOICE_COMPANION_CALM',
}

/** All platform voice ids (re-exported for mapping-completeness checks). */
export { PLATFORM_VOICE_IDS }

export interface VoiceMappingIssue {
  voiceId: PlatformVoiceId
  envVar: keyof VoiceMappingEnv
}

export interface VoiceMappingReadiness {
  ok: boolean
  configured: Array<VoiceMappingIssue & { volcengineVoiceType: string }>
  missing: VoiceMappingIssue[]
}

function readConfiguredToken(env: VoiceMappingEnv, envVar: keyof VoiceMappingEnv): string | null {
  const token = env[envVar]?.trim()
  if (token === undefined || token === '') return null
  if (isPlaceholderToken(token)) return null
  return token
}

function isPlaceholderToken(token: string): boolean {
  const normalized = token.toLowerCase()
  return (
    normalized.startsWith('placeholder_') ||
    normalized.includes('placeholder') ||
    normalized.includes('todo') ||
    normalized.includes('replace_me') ||
    normalized.includes('real token') ||
    normalized.includes('<') ||
    normalized.includes('>')
  )
}

/**
 * Read the configured Volcengine mapping from deployment env. Pure and
 * side-effect free; use this in launch readiness checks where a missing token
 * must fail loudly before exposing mode2.
 */
export function checkVoiceMappingReadiness(env: VoiceMappingEnv): VoiceMappingReadiness {
  const configured: VoiceMappingReadiness['configured'] = []
  const missing: VoiceMappingIssue[] = []

  for (const voiceId of PLATFORM_VOICE_IDS) {
    const envVar = VOICE_ENV_BINDINGS[voiceId]
    const token = readConfiguredToken(env, envVar)
    if (token === null) {
      missing.push({ voiceId, envVar })
    } else {
      configured.push({ voiceId, envVar, volcengineVoiceType: token })
    }
  }

  return { ok: missing.length === 0, configured, missing }
}

/**
 * Launch-readiness gate: all platform voice ids must have real deploy-configured
 * Volcengine voice tokens. Throws with exact missing variable names.
 */
export function assertVoiceMappingReady(env: VoiceMappingEnv): void {
  const readiness = checkVoiceMappingReadiness(env)
  if (readiness.ok) return
  const missing = readiness.missing
    .map(({ voiceId, envVar }) => `${voiceId} -> ${envVar}`)
    .join(', ')
  throw new Error(`voice-id-mapping: missing deploy voice mapping env vars: ${missing}`)
}

/**
 * Resolve the vendor voice parameters for a platform voice id at session
 * assembly. Total — never throws: an unknown id or an unfilled `PLACEHOLDER_*`
 * token degrades to `undefined` (caller keeps the provider's default voice)
 * with a `console.warn`, so session creation never fails on a voice-mapping gap.
 */
export function resolveVendorVoice(
  voiceId: string,
  env: VoiceMappingEnv
): VendorVoiceParams | undefined {
  if (!(PLATFORM_VOICE_IDS as readonly string[]).includes(voiceId)) {
    console.warn(
      `voice-id-mapping: no vendor mapping for voice_id "${voiceId}" (known: ${PLATFORM_VOICE_IDS.join(', ')}); using the provider default voice`
    )
    return undefined
  }
  const platformVoiceId = voiceId as PlatformVoiceId
  const envVar = VOICE_ENV_BINDINGS[platformVoiceId]
  const token = readConfiguredToken(env, envVar)
  if (token === null) {
    console.warn(
      `voice-id-mapping: voice_id "${voiceId}" is missing a real deploy env ${envVar}; using the provider default voice (run packages/platform-ai post-deploy readiness before launch)`
    )
    return undefined
  }
  return { volcengineVoiceType: token }
}
