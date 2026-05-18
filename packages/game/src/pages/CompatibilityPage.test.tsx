/**
 * CompatibilityPage unit tests.
 *
 * Covers the four IA acceptance points for the discovery-side rendering:
 *   1. Title + subtitle render.
 *   2. Exactly the three AI rows (Claude / ChatGPT / Gemini) appear, with
 *      Claude flagged as 已验证.
 *   3. Recommended opening-prompt block renders multi-line Chinese text.
 *   4. Copy button click triggers success feedback ("已复制！").
 *   5. Return-home link points to `/`.
 *
 * Clipboard helper is stubbed so the test doesn't depend on jsdom's
 * Clipboard API surface and the success branch is exercised deterministically.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('@/utils/clipboard', () => ({
  copyToClipboard: vi.fn().mockResolvedValue(true),
}))

import CompatibilityPage from './CompatibilityPage'
import { copyToClipboard } from '@/utils/clipboard'

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/compatibility']}>
      <CompatibilityPage />
    </MemoryRouter>
  )
}

describe('CompatibilityPage', () => {
  beforeEach(() => {
    vi.mocked(copyToClipboard).mockClear()
    vi.mocked(copyToClipboard).mockResolvedValue(true)
  })

  afterEach(() => {
    vi.clearAllTimers()
  })

  it('renders the H1 title and subtitle', () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: '支持的 AI 工具' })).toBeInTheDocument()
    expect(screen.getByText(/BombSquad 不集成任何 AI 接口/)).toBeInTheDocument()
  })

  it('renders exactly three AI rows: Claude / ChatGPT / Gemini', () => {
    renderPage()
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('Claude')
    expect(rows[1]).toHaveTextContent('ChatGPT')
    expect(rows[2]).toHaveTextContent('Gemini')
  })

  it('marks the Claude row as 已验证', () => {
    renderPage()
    const claudeRow = screen.getAllByRole('listitem')[0]
    expect(claudeRow).toHaveTextContent('已验证')
  })

  it('renders the recommended opening-prompt block with multi-line Chinese text', () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 2, name: '告诉 AI 该怎么做' })).toBeInTheDocument()
    // Prompt must include the signature lines from the recommended template.
    expect(screen.getByText(/等会儿我会发你一个 URL/)).toBeInTheDocument()
    expect(screen.getByText(/每次只回复一步指令/)).toBeInTheDocument()
  })

  it('shows "已复制！" feedback after clicking the copy button', async () => {
    renderPage()
    const button = screen.getByRole('button', { name: /复制推荐开场白到剪贴板/ })
    expect(button).toHaveTextContent('复制开场白')

    fireEvent.click(button)

    await waitFor(() => {
      expect(button).toHaveTextContent('已复制！')
    })
    expect(copyToClipboard).toHaveBeenCalledTimes(1)
    const copiedArg = vi.mocked(copyToClipboard).mock.calls[0][0]
    expect(copiedArg).toMatch(/等会儿我会发你一个 URL/)
  })

  it('renders a return-home link pointing to /', () => {
    renderPage()
    const link = screen.getByRole('link', { name: /返回 BombSquad 首页/ })
    expect(link).toHaveAttribute('href', '/')
  })
})
