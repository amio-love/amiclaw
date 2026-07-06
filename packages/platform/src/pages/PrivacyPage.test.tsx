/**
 * PrivacyPage rendering test.
 *
 * Asserts the production privacy policy renders and that the faithfulness-
 * critical facts are present: the retention windows (48h leaderboard / 30d
 * telemetry / 30d sessions / 90d audit), the contact address, the mode① versus
 * mode② data split, and the public-leaderboard disclosure. These are the
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
    expect(screen.getByText(/本政策说明 AMIO 游乐场收集哪些信息/)).toBeInTheDocument()
  })

  it('states the 48-hour leaderboard and 30-day telemetry retention windows', () => {
    renderPage()
    expect(screen.getByText(/保留 48\s*小时后自动过期/)).toBeInTheDocument()
    expect(screen.getByText(/保留 30 天后自动过期/)).toBeInTheDocument()
    expect(screen.getByText(/会话记录与会话[\s\S]*Cookie 默认保留 30 天/)).toBeInTheDocument()
    expect(screen.getByText(/认证审计记录保留 90 天/)).toBeInTheDocument()
  })

  it('discloses the public leaderboard and what it shows', () => {
    renderPage()
    expect(
      screen.getByText(/你的昵称、通关用时、当日尝试次数，以及你所填的[\s\S]*AI 工具与模型/)
    ).toBeInTheDocument()
    expect(screen.getByText(/在每日排行榜上公开展示/)).toBeInTheDocument()
  })

  it('discloses the mode-specific email and account session collection', () => {
    renderPage()
    expect(screen.getByText(/平台 AI[\s\S]*伙伴需要登录邮箱来建立账号会话/)).toBeInTheDocument()
    expect(screen.getAllByText(/amiclaw_session/).length).toBeGreaterThan(0)
    expect(screen.getByText(/自带 AI 游玩不要求邮箱、手机号或真实姓名/)).toBeInTheDocument()
  })

  it('names Cloudflare and platform AI providers as processors', () => {
    renderPage()
    expect(screen.getByText(/Cloudflare Pages/)).toBeInTheDocument()
    expect(screen.getByText(/Cloudflare KV/)).toBeInTheDocument()
    expect(screen.getByText(/Cloudflare D1/)).toBeInTheDocument()
    expect(screen.getByText(/Volcengine/)).toBeInTheDocument()
    expect(screen.getByText(/DeepSeek/)).toBeInTheDocument()
  })

  it('discloses Companion Memory and user controls', () => {
    renderPage()
    expect(screen.getAllByText(/Companion Memory/).length).toBeGreaterThan(0)
    expect(screen.getByText(/删除对应回忆、删除或更正个人画像项/)).toBeInTheDocument()
    expect(screen.getAllByText(/关闭个人画像层/).length).toBeGreaterThan(0)
  })

  it('provides the deletion / contact email and an effective date', () => {
    renderPage()
    const mailtoLinks = screen.getAllByRole('link', { name: 'hi@amio.love' })
    expect(mailtoLinks.length).toBeGreaterThan(0)
    expect(mailtoLinks[0]).toHaveAttribute('href', 'mailto:hi@amio.love')
    expect(screen.getByText(/生效日期：2026-07-06/)).toBeInTheDocument()
  })
})
