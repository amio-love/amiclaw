/**
 * Re-export shim: the pure audio-format helpers live in the game-agnostic
 * `@shared/voice/audio-pcm`. This path is the Botanical-local import surface;
 * the implementation is shared with every voice consumer.
 */
export * from '@shared/voice/audio-pcm'
