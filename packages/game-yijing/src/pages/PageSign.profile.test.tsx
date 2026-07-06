import { cleanup, render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ArcadeProfileEvent } from '@amiclaw/arcade-profile/types'

const mocks = vi.hoisted(() => ({
  session: {
    sessionId: 'oracle-session',
    yaoValues: null as number[] | null,
  },
  recordOracleLocalSign: vi.fn(),
  submitArcadeProfileEvent: vi.fn(() => Promise.resolve({ kind: 'anon' })),
}))

vi.mock('../session', () => ({
  useSession: () => mocks.session,
}))

vi.mock('@amiclaw/arcade-profile/local', () => ({
  recordOracleLocalSign: mocks.recordOracleLocalSign,
}))

vi.mock('@amiclaw/arcade-profile/api-client', () => ({
  submitArcadeProfileEvent: mocks.submitArcadeProfileEvent,
}))

import { PageSign } from './PageSign'

function renderPage() {
  return render(
    <MemoryRouter>
      <PageSign />
    </MemoryRouter>
  )
}

describe('PageSign arcade profile write', () => {
  afterEach(() => {
    cleanup()
    mocks.session.sessionId = 'oracle-session'
    mocks.session.yaoValues = null
    mocks.recordOracleLocalSign.mockReset()
    mocks.submitArcadeProfileEvent.mockReset()
    mocks.submitArcadeProfileEvent.mockResolvedValue({ kind: 'anon' })
  })

  it('does not save the demo fallback sign', async () => {
    renderPage()
    await Promise.resolve()

    expect(mocks.recordOracleLocalSign).not.toHaveBeenCalled()
    expect(mocks.submitArcadeProfileEvent).not.toHaveBeenCalled()
  })

  it('saves a real cast sign locally and submits it for logged-in accounts', async () => {
    const event: ArcadeProfileEvent = {
      kind: 'oracle_sign',
      profile_id: 'local-profile',
      sign: {
        source_key: 'oracle:2026-07-06:oracle-session',
        session_id: 'oracle-session',
        sign_date: '2026-07-06',
        ben: '同人',
        bian: '无妄',
        yao_values: [7, 8, 9, 7, 7, 7],
        created_at: '2026-07-06T08:00:00.000Z',
      },
    }
    mocks.session.yaoValues = [7, 8, 9, 7, 7, 7]
    mocks.recordOracleLocalSign.mockReturnValue(event)

    renderPage()

    await waitFor(() => expect(mocks.recordOracleLocalSign).toHaveBeenCalledTimes(1))
    expect(mocks.recordOracleLocalSign).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'oracle-session',
        yaoValues: [7, 8, 9, 7, 7, 7],
      })
    )
    expect(mocks.submitArcadeProfileEvent).toHaveBeenCalledWith(event)
  })
})
