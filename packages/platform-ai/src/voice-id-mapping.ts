/**
 * Platform-neutral `voice_id` -> vendor voice-parameter mapping (companion
 * memory L2 §Mechanism Variant 3, continuity across vendors).
 *
 * Lives on the provider-config plane: the companion profile stores ONLY the
 * platform-neutral id (`companion-warm` / ...); the concrete vendor token is
 * resolved server-side here at session assembly (`session-assembly.ts` threads
 * it into the TTS provider as the speaker override). Switching the TTS vendor
 * or model = editing this mapping — the companion profile is never touched.
 *
 * Resolution is TOTAL, mirroring the companion-context resolver's degrade
 * semantics: an unknown id or an unfilled deploy-time placeholder resolves to
 * `undefined` with a `console.warn`, and the session keeps the provider's
 * default voice. A voice-mapping gap must never fail session creation — the
 * companion's voice is identity, but a degraded voice beats no session.
 *
 * The Volcengine tokens are deploy-time placeholders, mirroring the
 * `PLACEHOLDER_*` convention in `wrangler.toml`: the mapping MECHANISM and its
 * completeness test are the deliverable here; back-filling the concrete
 * voice_type tokens against the real endpoint is a DEPLOY-BLOCKING checklist
 * item (see `functions/api/companion/PROVISIONING.md` §5). No guessed token
 * goes on the wire: an unfilled placeholder degrades to the default voice at
 * runtime (warned, never thrown).
 */

import { PLATFORM_VOICE_IDS, type PlatformVoiceId } from '../../companion-memory/src/types'

/** Vendor-facing voice parameters for one platform voice id. */
export interface VendorVoiceParams {
  /** Concrete Volcengine TTS `voice_type` token. */
  volcengineVoiceType: string
}

/** Deploy-time placeholder marker — an unfilled token, never sent on the wire. */
const PLACEHOLDER_PREFIX = 'PLACEHOLDER_'

/**
 * The vendor mapping table. Exported so the completeness test can assert every
 * platform voice id has an entry (a vendor switch must never leave a companion
 * voice unmapped).
 */
export const VOICE_MAPPING: Record<PlatformVoiceId, VendorVoiceParams> = {
  'companion-warm': { volcengineVoiceType: 'PLACEHOLDER_VOLC_VOICE_TYPE_WARM' },
  'companion-bright': { volcengineVoiceType: 'PLACEHOLDER_VOLC_VOICE_TYPE_BRIGHT' },
  'companion-calm': { volcengineVoiceType: 'PLACEHOLDER_VOLC_VOICE_TYPE_CALM' },
}

/** All platform voice ids (re-exported for mapping-completeness checks). */
export { PLATFORM_VOICE_IDS }

/**
 * Resolve the vendor voice parameters for a platform voice id at session
 * assembly. Total — never throws: an unknown id or an unfilled `PLACEHOLDER_*`
 * token degrades to `undefined` (caller keeps the provider's default voice)
 * with a `console.warn`, so session creation never fails on a voice-mapping
 * gap. `mapping` is injectable for tests only.
 */
export function resolveVendorVoice(
  voiceId: string,
  mapping: Record<string, VendorVoiceParams> = VOICE_MAPPING
): VendorVoiceParams | undefined {
  const params = mapping[voiceId]
  if (params === undefined) {
    console.warn(
      `voice-id-mapping: no vendor mapping for voice_id "${voiceId}" (known: ${PLATFORM_VOICE_IDS.join(', ')}); using the provider default voice`
    )
    return undefined
  }
  if (params.volcengineVoiceType.startsWith(PLACEHOLDER_PREFIX)) {
    console.warn(
      `voice-id-mapping: voice_id "${voiceId}" maps to unfilled placeholder "${params.volcengineVoiceType}"; using the provider default voice (back-fill per functions/api/companion/PROVISIONING.md §5)`
    )
    return undefined
  }
  return params
}
