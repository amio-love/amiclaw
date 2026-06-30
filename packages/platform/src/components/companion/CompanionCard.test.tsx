/**
 * CompanionCard stats-strip tests.
 *
 *   1. real mode: 「在一起 N 天」 is computed from the companion's real
 *      `created_at`, and the seed-only game stats (完成 / 成功) are hidden;
 *   2. seed mode: the full strip (在一起 + 完成 + 成功) shows, and the read
 *      never calls fetch (READ-ONLY seed).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import CompanionCard from './CompanionCard'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

const SEED_STORAGE_KEY = 'amiclaw:companionSeed'

function renderCard() {
  return render(
    <MemoryRouter>
      <CompanionCard />
    </MemoryRouter>
  )
}

/** The StatPill whose label matches, scoped so its value is assertable without
    colliding with another pill that shows the same number. */
function pillByLabel(label: string): HTMLElement {
  const labelEl = screen.getByText(label)
  // StatPill renders <div class=pill><span value/><span label/></div>.
  const pill = labelEl.parentElement as HTMLElement
  return pill
}

describe('CompanionCard stats strip', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    window.sessionStorage.clear()
  })

  it('real mode: computes 在一起 N 天 from created_at and hides game stats', async () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 86_400_000).toISOString()
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/api/companion')) {
          return Promise.resolve(
            json({
              name: '小南',
              address_style: '队长',
              voice_id: 'companion-warm',
              profile_enabled: true,
              created_at: fiveDaysAgo,
            })
          )
        }
        return Promise.resolve(json({}, 404))
      })
    )

    renderCard()

    expect(await screen.findByText('小南')).toBeInTheDocument()
    // The real days-together stat.
    const daysPill = pillByLabel('在一起 · 天')
    expect(within(daysPill).getByText('5')).toBeInTheDocument()
    // The seed-only game stats are hidden in production / real mode.
    expect(screen.queryByText('完成 · 局')).not.toBeInTheDocument()
    expect(screen.queryByText('成功 · 次')).not.toBeInTheDocument()
  })

  it('seed mode: shows the full strip and never calls fetch', async () => {
    // jsdom host is localhost (a seed-allowed host); the persisted flag enables seed.
    window.sessionStorage.setItem(SEED_STORAGE_KEY, '1')
    const fetchSpy = vi.fn(() => Promise.reject(new Error('fetch must not run in seed mode')))
    vi.stubGlobal('fetch', fetchSpy)

    renderCard()

    expect(await screen.findByText('小南')).toBeInTheDocument()
    // A days-together pill is always present (exact copy depends on the clock vs
    // the seed's 2026-05-30 created_at, so assert either form).
    expect(screen.queryByText('在一起 · 天') ?? screen.queryByText('认识你')).toBeInTheDocument()
    // The seed-only counters.
    expect(within(pillByLabel('完成 · 局')).getByText('12')).toBeInTheDocument()
    expect(within(pillByLabel('成功 · 次')).getByText('9')).toBeInTheDocument()

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
