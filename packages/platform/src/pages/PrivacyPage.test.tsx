/**
 * PrivacyPage rendering test.
 *
 * Asserts the production privacy policy renders and that the faithfulness-
 * critical facts are present: the retention windows (48h leaderboard / 30d
 * telemetry), the contact address, the "we do not collect email / phone /
 * real name" disclaimer, and the public-leaderboard disclosure. These are the
 * legal-compliance load-bearing claims, so the test guards them against an
 * accidental edit that would make the page misstate the real data practice.
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import PrivacyPage from './PrivacyPage'

function renderPage() {
  return render(
    <MemoryRouter>
      <PrivacyPage />
    </MemoryRouter>
  )
}

describe('PrivacyPage', () => {
  it('renders the policy with its title and lead', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: /我们如何对待你的数据/ })).toBeInTheDocument()
    expect(screen.getByText(/本政策说明 AmiClaw 收集哪些信息/)).toBeInTheDocument()
  })

  it('states the 48-hour leaderboard and 30-day telemetry retention windows', () => {
    renderPage()
    expect(screen.getByText(/保留 48\s*小时后自动过期/)).toBeInTheDocument()
    expect(screen.getByText(/保留 30 天后自动过期/)).toBeInTheDocument()
  })

  it('discloses the public leaderboard and what it shows', () => {
    renderPage()
    expect(
      screen.getByText(/你的昵称、通关用时、当日尝试次数，以及你所填的[\s\S]*AI 工具与模型/)
    ).toBeInTheDocument()
    expect(screen.getByText(/在每日排行榜上公开展示/)).toBeInTheDocument()
  })

  it('carries the faithful "we do not collect email / phone / real name" disclaimer', () => {
    renderPage()
    expect(
      screen.getByText(/我们不收集邮箱、手机号、真实姓名、精确地理位置或任何支付信息/)
    ).toBeInTheDocument()
  })

  it('names Cloudflare as the hosting and storage processor', () => {
    renderPage()
    expect(screen.getByText(/Cloudflare Pages/)).toBeInTheDocument()
    expect(screen.getByText(/Cloudflare KV/)).toBeInTheDocument()
  })

  it('provides the deletion / contact email and an effective date', () => {
    renderPage()
    const mailtoLinks = screen.getAllByRole('link', { name: 'hi@amio.love' })
    expect(mailtoLinks.length).toBeGreaterThan(0)
    expect(mailtoLinks[0]).toHaveAttribute('href', 'mailto:hi@amio.love')
    expect(screen.getByText(/生效日期：2026-06-07/)).toBeInTheDocument()
  })
})
