/**
 * Re-export shim: the game-agnostic voice-session protocol (wire envelope types,
 * exposed-state reducer, URL builder) lives in `@shared/voice/voice-session-protocol`.
 * This path is the Botanical-local import surface; the implementation is shared
 * with every voice consumer (bombsquad, lobby).
 *
 * The one Botanical-local addition is `randomSessionName`: each consumer mints
 * its own self-identifying WS session name (here `botanical-…`), so the
 * generator lives with its consumer, not in the shared module.
 */
export * from '@shared/voice/voice-session-protocol'

/** Generate a random, collision-unlikely Botanical session name for the WS path. */
export function randomSessionName(): string {
  return `botanical-${Math.random().toString(36).slice(2, 10)}`
}
