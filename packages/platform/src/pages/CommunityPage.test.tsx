/**
 * CommunityPage integration tests.
 *
 * The community page is a REAL derived event stream (audit F4 rework). These
 * cover the four behaviors that matter: real items render (and the old fake
 * copy is gone), the honest quiet state on an empty window, the anonymous like
 * gate (a login hint, no write), and a signed-in optimistic like.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import CommunityPage from './CommunityPage'
import {
  fetchArcadeCommunityFeed,
  setArcadeCommunityLike,
} from '@amiclaw/arcade-profile/api-client'
import type { ArcadeCommunityFeedItem } from '@amiclaw/arcade-profile/types'
import type { AuthState } from '@/hooks/useAuth'

vi.mock('@amiclaw/arcade-profile/api-client', () => ({
  fetchArcadeCommunityFeed: vi.fn(),
  setArcadeCommunityLike: vi.fn(),
}))

const authState: { current: AuthState } = { current: { status: 'anon', user: null } }
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ ...authState.current, logout: async () => {} }),
}))

const mockedFetch = vi.mocked(fetchArcadeCommunityFeed)
const mockedLike = vi.mocked(setArcadeCommunityLike)

const NOVA: ArcadeCommunityFeedItem = {
  id: 'e0123456789abcdef',
  template: 'daily_clear',
  public_label: 'Nova',
  at: new Date(Date.now() - 5 * 60_000).toISOString(),
  duration_ms: 55_000,
  like_count: 2,
  liked: false,
}

function renderPage() {
  return render(
    <MemoryRouter>
      <CommunityPage />
    </MemoryRouter>
  )
}

describe('CommunityPage', () => {
  beforeEach(() => {
    authState.current = { status: 'anon', user: null }
    mockedFetch.mockReset()
    mockedLike.mockReset()
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders real feed items and drops the fabricated marketing copy', async () => {
    mockedFetch.mockResolvedValue({ kind: 'ok', feed: { items: [NOVA], next_before: null } })
    renderPage()

    expect(await screen.findByText('Nova')).toBeInTheDocument()
    expect(screen.getByText('拆除了每日挑战。')).toBeInTheDocument()
    expect(screen.getByText(/真实玩家动态/)).toBeInTheDocument()
    expect(screen.queryByText(/每天有数百条新内容/)).not.toBeInTheDocument()
  })

  it('shows the honest quiet state when the window is empty', async () => {
    mockedFetch.mockResolvedValue({ kind: 'ok', feed: { items: [], next_before: null } })
    renderPage()

    expect(await screen.findByText(/今天还很安静/)).toBeInTheDocument()
  })

  it('gates liking behind login for an anonymous visitor', async () => {
    mockedFetch.mockResolvedValue({ kind: 'ok', feed: { items: [NOVA], next_before: null } })
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: '点赞' }))

    expect(await screen.findByText(/登录后即可点赞/)).toBeInTheDocument()
    expect(mockedLike).not.toHaveBeenCalled()
  })

  it('anchors the login hint in the tapped card, not at the page top (F5)', async () => {
    mockedFetch.mockResolvedValue({ kind: 'ok', feed: { items: [NOVA], next_before: null } })
    renderPage()

    const likeBtn = await screen.findByRole('button', { name: '点赞' })
    // No hint before the tap — the feedback is the tap's response.
    expect(screen.queryByText(/登录后即可点赞/)).not.toBeInTheDocument()
    fireEvent.click(likeBtn)

    // The hint lands in the SAME card footer as the like button (co-located
    // feedback), never as a stray line at the page top.
    const hint = await screen.findByText(/登录后即可点赞/)
    const footer = likeBtn.closest('div')
    expect(footer).not.toBeNull()
    expect(footer).toContainElement(hint)
  })

  it('optimistically likes for a signed-in visitor', async () => {
    authState.current = {
      status: 'authed',
      user: { user_id: 'u1', email: 'u@x.com', displayName: 'u', avatarLetter: 'U' },
    }
    mockedFetch.mockResolvedValue({ kind: 'ok', feed: { items: [NOVA], next_before: null } })
    mockedLike.mockResolvedValue({
      kind: 'ok',
      like: { event_id: NOVA.id, like_count: 3, liked: true },
    })
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: '点赞' }))

    expect(mockedLike).toHaveBeenCalledWith(NOVA.id, true)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '取消点赞' })).toHaveTextContent('3')
    )
  })
})
