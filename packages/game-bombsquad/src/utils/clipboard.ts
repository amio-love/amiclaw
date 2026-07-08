// Robust text copy — single source of truth in `shared/clipboard.ts` so the
// BombSquad and Oracle (yijing) share surfaces cannot drift. Re-exported here
// to keep the existing `@/utils/clipboard` import path (and its test mocks).
export { copyToClipboard } from '@shared/clipboard'
