/**
 * CompatibilityPage unit tests.
 *
 * Covers the IA acceptance points for the discovery-side rendering:
 *   1. Title + subtitle render.
 *   2. The shared AI tool list renders in canonical order, with Claude flagged
 *      as 已验证.
 *   3. Return-home link points to `/bombsquad` (the BombSquad landing page).
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AI_TOOLS } from '@amiclaw/ui'

import CompatibilityPage from './CompatibilityPage'

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/bombsquad/compatibility']}>
      <CompatibilityPage />
    </MemoryRouter>
  )
}

describe('CompatibilityPage', () => {
  it('renders the H1 title and subtitle', () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: '支持的 AI 工具' })).toBeInTheDocument()
    expect(screen.getByText(/BombSquad 不集成任何 AI 接口/)).toBeInTheDocument()
  })

  it('renders the shared AI tool list in canonical order', () => {
    renderPage()
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(AI_TOOLS.length)

    AI_TOOLS.forEach((tool, index) => {
      expect(rows[index]).toHaveTextContent(tool)
    })
  })

  it('marks the Claude row as 已验证', () => {
    renderPage()
    const claudeRow = screen.getAllByRole('listitem')[0]
    expect(claudeRow).toHaveTextContent('已验证')
  })

  it('gives every unverified AI row a feedback status', () => {
    renderPage()
    const rows = screen.getAllByRole('listitem')

    for (const row of rows.slice(1)) {
      expect(row).toHaveTextContent('未测试 · 邀请反馈')
    }
  })

  it('renders a return-home link pointing to /bombsquad', () => {
    renderPage()
    const link = screen.getByRole('link', { name: /返回 BombSquad 首页/ })
    expect(link).toHaveAttribute('href', '/bombsquad')
  })
})
