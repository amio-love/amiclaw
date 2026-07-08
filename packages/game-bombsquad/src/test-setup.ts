import '@testing-library/jest-dom'
import { vi } from 'vitest'

vi.mock('@amiclaw/arcade-profile/api-client', () => ({
  submitArcadeProfileEvent: vi.fn(() => Promise.resolve({ kind: 'anon' })),
  // VoicePanel resolves the account streak (B9); default to no account read so
  // the streak degrades to 0 (device-local) and the create message omits it.
  fetchArcadeProfile: vi.fn(() => Promise.resolve({ kind: 'error' })),
}))
