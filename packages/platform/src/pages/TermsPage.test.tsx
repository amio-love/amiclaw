/**
 * TermsPage rendering test.
 *
 * Asserts the production user agreement renders and that its mandatory
 * sections are present: the applicable-law / dispute clause, the disclaimer,
 * platform-AI account terms, companion memory controls, and the public-display
 * clause. Also guards the contact address and effective date.
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import TermsPage from './TermsPage'

function renderPage() {
  return render(
    <MemoryRouter>
      <TermsPage />
    </MemoryRouter>
  )
}

describe('TermsPage', () => {
  it('renders the agreement with its title and lead', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: /使用本服务的约定/ })).toBeInTheDocument()
    expect(screen.getByText(/本条款是你与运营方就使用 AMIO 游乐场达成的协议/)).toBeInTheDocument()
  })

  it('covers the applicable-law and dispute-resolution section', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: /适用法律与争议解决/ })).toBeInTheDocument()
    expect(screen.getByText(/适用中华人民共和国法律/)).toBeInTheDocument()
  })

  it('covers the disclaimer section', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: /免责声明/ })).toBeInTheDocument()
    expect(screen.getByText(/按「现状」与「现有可用」基础提供/)).toBeInTheDocument()
    expect(screen.getByText(/第三方语音和语言模型供应商/)).toBeInTheDocument()
  })

  it('discloses that submitted content is publicly displayed', () => {
    renderPage()
    expect(screen.getByText(/将在每日排行榜上公开展示/)).toBeInTheDocument()
  })

  it('covers login-gated platform AI and companion memory controls', () => {
    renderPage()
    expect(screen.getByText(/登录后使用平台提供的 AI 伙伴/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /身份、账号与昵称/ })).toBeInTheDocument()
    expect(screen.getAllByText(/Companion Memory/).length).toBeGreaterThan(0)
    expect(screen.getByText(/删除回忆、删除或更正个人画像项/)).toBeInTheDocument()
  })

  it('provides the contact email and an effective date', () => {
    renderPage()
    const mailtoLinks = screen.getAllByRole('link', { name: 'hi@amio.love' })
    expect(mailtoLinks.length).toBeGreaterThan(0)
    expect(mailtoLinks[0]).toHaveAttribute('href', 'mailto:hi@amio.love')
    expect(screen.getByText(/生效日期：2026-07-04/)).toBeInTheDocument()
  })
})
