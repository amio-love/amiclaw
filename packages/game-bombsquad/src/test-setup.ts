import '@testing-library/jest-dom'
import { vi } from 'vitest'

vi.mock('@amiclaw/arcade-profile/api-client', () => ({
  submitArcadeProfileEvent: vi.fn(() => Promise.resolve({ kind: 'anon' })),
}))
