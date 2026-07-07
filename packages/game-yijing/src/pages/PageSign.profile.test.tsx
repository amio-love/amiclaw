import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ArcadeProfileEvent } from '@amiclaw/arcade-profile/types'

const mocks = vi.hoisted(() => ({
  session: {
    sessionId: 'oracle-session',
    yaoValues: null as number[] | null,
    castCreatedAt: null as string | null,
  },
  recordOracleLocalSign: vi.fn(),
  readArcadeLocalProfile: vi.fn(),
  markArcadeProfileEventsClaimed: vi.fn(),
  submitArcadeProfileEvent: vi.fn(() => Promise.resolve({ kind: 'anon' })),
}))

vi.mock('../session', () => ({
  useSession: () => mocks.session,
}))

vi.mock('@amiclaw/arcade-profile/local', () => ({
  recordOracleLocalSign: mocks.recordOracleLocalSign,
  readArcadeLocalProfile: mocks.readArcadeLocalProfile,
  markArcadeProfileEventsClaimed: mocks.markArcadeProfileEventsClaimed,
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
    mocks.session.castCreatedAt = null
    mocks.recordOracleLocalSign.mockReset()
    mocks.readArcadeLocalProfile.mockReset()
    mocks.markArcadeProfileEventsClaimed.mockReset()
    mocks.submitArcadeProfileEvent.mockReset()
    mocks.submitArcadeProfileEvent.mockResolvedValue({ kind: 'anon' })
    vi.unstubAllGlobals()
  })

  it('redirects home without a cast and saves nothing', async () => {
    renderPage()
    await Promise.resolve()

    expect(mocks.recordOracleLocalSign).not.toHaveBeenCalled()
    expect(mocks.submitArcadeProfileEvent).not.toHaveBeenCalled()
    // No demo fallback card — the page renders nothing but the redirect.
    expect(screen.queryByText('今日卦签')).toBeNull()
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
    mocks.session.castCreatedAt = '2026-07-06T08:00:00.000Z'
    mocks.recordOracleLocalSign.mockReturnValue(event)
    mocks.readArcadeLocalProfile.mockReturnValue({
      oracle_signs: [event.sign],
    })

    renderPage()

    await waitFor(() => expect(mocks.recordOracleLocalSign).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('已保存到本设备')).toBeTruthy()
    expect(mocks.recordOracleLocalSign).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'oracle-session',
        signDate: '2026-07-06',
        createdAt: '2026-07-06T08:00:00.000Z',
        yaoValues: [7, 8, 9, 7, 7, 7],
      })
    )
    expect(mocks.submitArcadeProfileEvent).toHaveBeenCalledWith(event)
  })

  it('does not save a persisted sign when the cast creation date is unavailable', async () => {
    mocks.session.yaoValues = [7, 8, 9, 7, 7, 7]
    mocks.session.castCreatedAt = null

    renderPage()

    await waitFor(() => expect(screen.getByText('本次卦签暂未写入档案')).toBeTruthy())
    expect(mocks.recordOracleLocalSign).not.toHaveBeenCalled()
    expect(mocks.submitArcadeProfileEvent).not.toHaveBeenCalled()
  })

  it('copies the share text with visible feedback', async () => {
    mocks.session.yaoValues = [7, 8, 9, 7, 7, 7]
    mocks.session.castCreatedAt = '2026-07-06T08:00:00.000Z'
    const writeText = vi.fn((_: string) => Promise.resolve())
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: '复制卦签' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(writeText.mock.calls[0][0]).toContain('AMIO 游乐场今日卦签')
    expect(await screen.findByText('分享文案已复制。')).toBeTruthy()
  })
})
