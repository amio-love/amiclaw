/**
 * UpcomingGames — Game Lab Discord tile wiring.
 *
 * The Game Lab tile gates on the shared DISCORD_INVITE_URL sentinel:
 *   1. configured (non-empty) -> a clickable <a> into the invite, opening in a
 *      new tab with rel="noopener noreferrer" and a「加入 Discord」cue
 *   2. empty (the current placeholder) -> a non-clickable tile, no link, same
 *      output as before this change (zero regression)
 *
 * The constant module is mocked per-test so both branches are exercised without
 * editing the real '' sentinel value.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

async function renderWith(discordUrl: string) {
  vi.resetModules()
  vi.doMock('@/config/links', () => ({ DISCORD_INVITE_URL: discordUrl }))
  const { default: UpcomingGames } = await import('./UpcomingGames')
  render(<UpcomingGames />)
}

describe('UpcomingGames — Game Lab Discord tile', () => {
  it('renders the Game Lab tile as a clickable Discord link when the URL is configured', async () => {
    await renderWith('https://discord.gg/example')

    const link = screen.getByRole('link', { name: /加入 Discord/ })
    expect(link).toHaveAttribute('href', 'https://discord.gg/example')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    // The Game Lab tile's own copy is still present inside the link.
    expect(link).toHaveTextContent('Game Lab')
  })

  it('keeps the Game Lab tile non-clickable when the URL is the empty sentinel', async () => {
    await renderWith('')

    // No Discord link and no cue exist in the placeholder state.
    expect(screen.queryByRole('link', { name: /加入 Discord/ })).not.toBeInTheDocument()
    expect(screen.queryByText('加入 Discord →')).not.toBeInTheDocument()
    // The Game Lab tile still renders its name as plain (non-link) text.
    expect(screen.getByText('Game Lab')).toBeInTheDocument()
  })

  it('renders Shadow Chase, Oracle, Botanical, Radio Cipher and Sound Garden as playable peer cards before future games', async () => {
    await renderWith('')

    const links = screen.getAllByRole('link')
    const shadow = screen.getByRole('link', { name: /双影追逃/ })
    const oracle = screen.getByRole('link', { name: /易经签卜/ })
    const botanical = screen.getByRole('link', { name: /植物园养护/ })
    const radio = screen.getByRole('link', { name: /密码电台/ })
    const sound = screen.getByRole('link', { name: /声音花园/ })
    expect(shadow).toHaveAttribute('href', '/shadow-chase/')
    expect(oracle).toHaveAttribute('href', '/oracle/#/home')
    expect(botanical).toHaveAttribute('href', '/botanical/')
    expect(radio).toHaveAttribute('href', '/radio-cipher/')
    expect(sound).toHaveAttribute('href', '/sound-garden/')
    expect(links.indexOf(shadow)).toBeLessThan(links.indexOf(oracle))
    expect(links.indexOf(oracle)).toBeLessThan(links.indexOf(botanical))
    expect(links.indexOf(botanical)).toBeLessThan(links.indexOf(radio))
    expect(links.indexOf(radio)).toBeLessThan(links.indexOf(sound))
    expect(screen.getAllByText('可玩')).toHaveLength(5)

    // Future games remain honest, non-clickable cards.
    expect(screen.getAllByText('星海回声').length).toBeGreaterThan(0)
    expect(screen.getAllByText('共绘星图').length).toBeGreaterThan(0)
    expect(screen.queryByRole('link', { name: /星海回声/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /共绘星图/ })).not.toBeInTheDocument()
    expect(screen.getAllByText('即将上线')).toHaveLength(2)
    expect(screen.getByText('开发中')).toBeInTheDocument()
    expect(screen.queryByText('预览体验')).not.toBeInTheDocument()
  })
})
