/**
 * Re-export shim: the pure VAD reducer moved to the game-agnostic
 * `@shared/voice/voice-vad` so the lobby voice session can reuse it. This path
 * stays as the BombSquad-local import surface; the implementation is shared.
 */
export * from '@shared/voice/voice-vad'
