/**
 * Lobby-voice capability flag.
 *
 * FALSE until a lobby voice channel actually exists (a `companion-lobby`
 * provider-config entry + a manual-less session assembly on the platform-ai
 * Worker — the next companion slice). While false, the platform shell must
 * never touch mic / permission APIs: a permission prompt in a context that
 * cannot deliver voice is dishonest, and a stub-era denial would permanently
 * poison the `denied-remembered` posture before lobby voice ever ships.
 *
 * Flipping this to true engages the full ratified auto-voice-on-login
 * sequence in `useCompanionPresence` (greeting text -> 300ms -> permission
 * request -> voice greeting / denial memory) exactly as designed — the
 * sequence code is kept live and test-pinned behind this flag
 * (CompanionDock.lobby-voice.test.tsx).
 */
export const LOBBY_VOICE_CAPABLE = false

/** The honest mic-button note while lobby voice is off (restrained register). */
export const LOBBY_VOICE_NOTE = '语音陪伴在拆弹局内可用，进入每日挑战开启。'
