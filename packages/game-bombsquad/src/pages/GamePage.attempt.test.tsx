import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('@/utils/event-log', () => ({ logEvent: vi.fn() }))
vi.mock('@/audio/audio-context', () => ({
  getAudioContext: vi.fn().mockReturnValue(null),
  isSfxSuppressed: vi.fn().mockReturnValue(false),
  setMasterMuted: vi.fn(),
  setSfxSuppressed: vi.fn(),
}))
vi.mock('@/voice/VoicePanel', () => ({ default: () => null }))

const {
  loadManualMock,
  generateWireMock,
  generateDialMock,
  generateButtonMock,
  generateKeypadMock,
} = vi.hoisted(() => ({
  loadManualMock: vi.fn(),
  generateWireMock: vi.fn(() => ({ config: {}, answer: {} })),
  generateDialMock: vi.fn(() => ({ config: {}, answer: {} })),
  generateButtonMock: vi.fn(() => ({ config: {}, answer: {} })),
  generateKeypadMock: vi.fn(() => ({ config: {}, answer: {} })),
}))

vi.mock('@/utils/yaml-loader', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/utils/yaml-loader')>()
  return {
    ...real,
    loadManual: loadManualMock,
  }
})

vi.mock('@/modules/wire/generator', () => ({ generateWire: generateWireMock }))
vi.mock('@/modules/dial/generator', () => ({ generateDial: generateDialMock }))
vi.mock('@/modules/button/generator', () => ({ generateButton: generateButtonMock }))
vi.mock('@/modules/keypad/generator', () => ({ generateKeypad: generateKeypadMock }))

vi.mock('@/modules/wire/WireModule', () => ({ default: () => <div data-testid="wire-module" /> }))
vi.mock('@/modules/dial/DialModule', () => ({ default: () => <div data-testid="dial-module" /> }))
vi.mock('@/modules/button/ButtonModule', () => ({
  default: () => <div data-testid="button-module" />,
}))
vi.mock('@/modules/keypad/KeypadModule', () => ({
  default: () => <div data-testid="keypad-module" />,
}))

import GamePage from './GamePage'
import { GameProvider } from '@/store/game-context'
import { getDailyAttemptKey } from '@/utils/session'

const MINIMAL_MANUAL = {
  modules: {
    wire_routing: { rules: [] },
    symbol_dial: { columns: [] },
    button: { rules: [] },
    keypad: { sequences: [] },
  },
}

function renderDailyRun() {
  return render(
    <MemoryRouter initialEntries={['/bombsquad/run?mode=daily']}>
      <GameProvider>
        <GamePage />
      </GameProvider>
    </MemoryRouter>
  )
}

describe('GamePage daily attempt persistence', () => {
  beforeEach(() => {
    sessionStorage.clear()
    loadManualMock.mockReset()
    generateWireMock.mockClear()
    generateDialMock.mockClear()
    generateButtonMock.mockClear()
    generateKeypadMock.mockClear()
  })

  afterEach(() => {
    sessionStorage.clear()
  })

  it('does not persist a daily attempt when manual loading fails before the first module', async () => {
    loadManualMock.mockRejectedValueOnce(new Error('offline'))

    renderDailyRun()

    await waitFor(() => {
      expect(screen.getByText(/加载失败/)).toBeInTheDocument()
    })

    expect(sessionStorage.getItem(getDailyAttemptKey())).toBeNull()
  })

  it('persists the previewed daily attempt only once the run reaches the first module', async () => {
    loadManualMock.mockResolvedValueOnce(MINIMAL_MANUAL as never)

    renderDailyRun()

    await waitFor(() => {
      expect(screen.getByTestId('wire-module')).toBeInTheDocument()
    })

    expect(sessionStorage.getItem(getDailyAttemptKey())).toBe('1')
  })
})
