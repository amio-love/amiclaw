/**
 * CompanionCard stats-strip tests.
 *
 *   1. real mode: 「相识 N 天」 is computed from the companion's real
 *      `created_at`, and the seed-only game stats (完成 / 成功) are hidden;
 *   2. seed mode: the full strip (在一起 + 完成 + 成功) shows, and the read
 *      never calls fetch (READ-ONLY seed).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { __resetCompanionStore } from '@/hooks/useCompanion'
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
  beforeEach(() => {
    __resetCompanionStore()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    window.sessionStorage.clear()
  })

  it('real mode: shows 相识 N 天 from created_at plus honest-zero game stats', async () => {
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
    // The real acquaintance-days stat — number + unit in the value, clean label.
    expect(within(pillByLabel('相识')).getByText('5 天')).toBeInTheDocument()
    // The game stats are ALWAYS shown — an honest 0 in production, never hidden.
    expect(within(pillByLabel('完成')).getByText('0 局')).toBeInTheDocument()
    expect(within(pillByLabel('成功')).getByText('0 次')).toBeInTheDocument()
  })

  it('seed mode: shows the full strip with illustrative numbers and never calls fetch', async () => {
    // jsdom host is localhost (a seed-allowed host); the persisted flag enables seed.
    window.sessionStorage.setItem(SEED_STORAGE_KEY, '1')
    const fetchSpy = vi.fn(() => Promise.reject(new Error('fetch must not run in seed mode')))
    vi.stubGlobal('fetch', fetchSpy)

    renderCard()

    expect(await screen.findByText('小南')).toBeInTheDocument()
    // A days-together pill is always present (exact copy depends on the clock vs
    // the seed's 2026-05-30 created_at, so assert either form).
    expect(screen.queryByText('相识') ?? screen.queryByText('认识你')).toBeInTheDocument()
    // The illustrative seed counters.
    expect(within(pillByLabel('完成')).getByText('12 局')).toBeInTheDocument()
    expect(within(pillByLabel('成功')).getByText('9 次')).toBeInTheDocument()

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
