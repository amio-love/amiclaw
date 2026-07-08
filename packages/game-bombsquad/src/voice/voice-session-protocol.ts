/**
 * Re-export shim: the game-agnostic voice-session protocol (wire envelope types,
 * exposed-state reducer, URL builder) moved to `@shared/voice/voice-session-protocol`
 * so the lobby voice session can reuse it. This path stays as the BombSquad-local
 * import surface; the implementation is shared.
 *
 * The one BombSquad-local addition is `randomSessionName`: each consumer mints its
 * own self-identifying WS session name (here `bombsquad-…`), so the generator is
 * NOT in the shared module — it lives with its consumer.
 */
export * from '@shared/voice/voice-session-protocol'

/** Generate a random, collision-unlikely BombSquad session name for the WS path. */
export function randomSessionName(): string {
  return `bombsquad-${Math.random().toString(36).slice(2, 10)}`
}
