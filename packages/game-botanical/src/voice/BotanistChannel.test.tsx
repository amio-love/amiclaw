import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GameVoiceManualData, GameVoiceState } from '@shared/voice/use-game-voice-session'
import BotanistChannel from './BotanistChannel'
import type { BotanicalVoiceEligibility } from './voice-eligibility'

vi.mock('./voice-eligibility', () => ({ useBotanicalVoiceEligibility: vi.fn() }))
import { useBotanicalVoiceEligibility } from './voice-eligibility'
const mockEligibility = vi.mocked(useBotanicalVoiceEligibility)

// Stub VoicePanel so the branch is testable without the voice hook / WS / mic.
vi.mock('./VoicePanel', () => ({ default: () => <div data-testid="voice-panel" /> }))

const manualData: GameVoiceManualData = { version: '1.1.0', sections: {} }
const gameState: GameVoiceState = { relevantSections: [] }

function renderChannel(gameId: string, eligibility: BotanicalVoiceEligibility) {
  mockEligibility.mockReturnValue(eligibility)
  return render(
    <MemoryRouter>
      <BotanistChannel
        manualData={manualData}
        gameState={gameState}
        gameId={gameId}
        manualTo="/manual?level=bg-demo-001"
      />
    </MemoryRouter>
  )
}

beforeEach(() => mockEligibility.mockReset())

describe('BotanistChannel — eligibility gate (§3)', () => {
  it('renders the companion VoicePanel for an eligible signed-in player', () => {
    renderChannel('botanical-garden', { status: 'eligible', companionName: '小苗' })
    expect(screen.getByTestId('voice-panel')).toBeInTheDocument()
  })

  it('skips the eligibility gate entirely for a dev/demo-mock session', () => {
    renderChannel('demo-mock', { status: 'ineligible', reason: 'anonymous' })
    expect(screen.getByTestId('voice-panel')).toBeInTheDocument()
  })

  it('shows the solo manual path (BYO-AI) for an anonymous player', () => {
    renderChannel('botanical-garden', { status: 'ineligible', reason: 'anonymous' })
    expect(screen.queryByTestId('voice-panel')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '打开养护手册' })).toHaveAttribute(
      'href',
      '/manual?level=bg-demo-001'
    )
    expect(screen.getByText(/登录并领取/)).toBeInTheDocument()
    expect(screen.getByText(/复制给你自己的 AI/)).toBeInTheDocument() // BYO-AI pointer
  })

  it('shows a checking state while eligibility resolves', () => {
    renderChannel('botanical-garden', { status: 'checking' })
    expect(screen.getByText(/正在确认/)).toBeInTheDocument()
    expect(screen.queryByTestId('voice-panel')).not.toBeInTheDocument()
  })
})
