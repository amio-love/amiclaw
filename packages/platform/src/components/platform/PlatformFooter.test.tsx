/**
 * PlatformFooter link-wiring test.
 *
 * 隐私 and 条款 are real react-router links to /privacy and /terms. 关于 is gone
 * (no destination exists). Discord is an honest-collapse external link bound to
 * the shared DISCORD_INVITE_URL sentinel: absent while '', a clickable external
 * <a> once configured. This test pins each half of that contract.
 *
 * The constant module is mocked per-test so both Discord branches are exercised
 * without editing the real '' sentinel value (mirrors UpcomingGames.test.tsx).
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

async function renderFooter(discordUrl: string) {
  vi.resetModules()
  vi.doMock('@/config/links', () => ({ DISCORD_INVITE_URL: discordUrl }))
  const { default: PlatformFooter } = await import('./PlatformFooter')
  render(
    <MemoryRouter>
      <PlatformFooter />
    </MemoryRouter>
  )
}

describe('PlatformFooter', () => {
  it('renders 隐私 as a link to /privacy', async () => {
    await renderFooter('')
    const link = screen.getByRole('link', { name: '隐私' })
    expect(link).toHaveAttribute('href', '/privacy')
  })

  it('renders 条款 as a link to /terms', async () => {
    await renderFooter('')
    const link = screen.getByRole('link', { name: '条款' })
    expect(link).toHaveAttribute('href', '/terms')
  })

  it('never renders 关于', async () => {
    await renderFooter('')
    expect(screen.queryByRole('link', { name: '关于' })).not.toBeInTheDocument()
    expect(screen.queryByText('关于')).not.toBeInTheDocument()
  })

  it('omits Discord while the invite is the empty sentinel', async () => {
    await renderFooter('')
    expect(screen.queryByRole('link', { name: 'Discord' })).not.toBeInTheDocument()
    expect(screen.queryByText('Discord')).not.toBeInTheDocument()
  })

  it('renders Discord as an external link once the invite is configured', async () => {
    await renderFooter('https://discord.gg/example')
    const link = screen.getByRole('link', { name: 'Discord' })
    expect(link).toHaveAttribute('href', 'https://discord.gg/example')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })
})
