/**
 * Re-export shim: the pure audio-format helpers moved to the game-agnostic
 * `@shared/voice/audio-pcm` so the lobby voice session can reuse them. This path
 * stays as the BombSquad-local import surface; the implementation is shared.
 */
export * from '@shared/voice/audio-pcm'
