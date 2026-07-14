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
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import CommunityPage from './CommunityPage'

// jsdom does not implement scrollIntoView; the anchored (`?event=`) card calls it.
Element.prototype.scrollIntoView = () => {}
import {
  fetchArcadeCommunityFeed,
  setArcadeCommunityLike,
} from '@amiclaw/arcade-profile/api-client'
import type {
  ArcadeCommunityFeedItem,
  ArcadeCommunityProxyThread,
} from '@amiclaw/arcade-profile/types'
import { sendCompanionProxyReply } from '@/lib/proxy-social-api'
import type { AuthState } from '@/hooks/useAuth'

vi.mock('@amiclaw/arcade-profile/api-client', () => ({
  fetchArcadeCommunityFeed: vi.fn(),
  setArcadeCommunityLike: vi.fn(),
}))

vi.mock('@/lib/proxy-social-api', () => ({
  sendCompanionProxyReply: vi.fn(),
}))

const authState: { current: AuthState } = { current: { status: 'anon', user: null } }
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ ...authState.current, logout: async () => {} }),
}))

const mockedFetch = vi.mocked(fetchArcadeCommunityFeed)
const mockedLike = vi.mocked(setArcadeCommunityLike)
const mockedReply = vi.mocked(sendCompanionProxyReply)

const NOVA: ArcadeCommunityFeedItem = {
  id: 'e0123456789abcdef',
  template: 'daily_clear',
  public_label: 'Nova',
  at: new Date(Date.now() - 5 * 60_000).toISOString(),
  duration_ms: 55_000,
  like_count: 2,
  liked: false,
  threads: [],
  viewer_is_owner: false,
  viewer_has_companion: false,
}

const SEALED_THREAD: ArcadeCommunityProxyThread = {
  message_id: 'm-sealed',
  author_companion_name: '阿澈',
  author_public_label: '蒙奇奇0605',
  body: '看到你上榜，替她道句漂亮。',
  created_at: new Date(Date.now() - 10 * 60_000).toISOString(),
  reply: {
    responder_companion_name: '小满',
    responder_public_label: 'Player 53CD',
    body: '这句真稳，我替他收下了。',
    created_at: new Date(Date.now() - 8 * 60_000).toISOString(),
  },
  can_reply: false,
}

const OPEN_THREAD: ArcadeCommunityProxyThread = {
  message_id: 'm-open',
  author_companion_name: '阿澈',
  author_public_label: '蒙奇奇0605',
  body: '看到你上榜，替她道句漂亮。',
  created_at: new Date(Date.now() - 4 * 60_000).toISOString(),
  reply: null,
  can_reply: true,
}

/** The open thread as it looks after 乙's companion replies — SAME message_id
    (the reply lands on it in place), now carrying the reply + can_reply false.
    This is what the post-reply refetch returns. */
const SEALED_OF_OPEN: ArcadeCommunityProxyThread = {
  ...OPEN_THREAD,
  reply: {
    responder_companion_name: '小满',
    responder_public_label: 'Player 53CD',
    body: '这句真稳，我替他收下了。',
    created_at: new Date(Date.now() - 1 * 60_000).toISOString(),
  },
  can_reply: false,
}

/** An owned event card (乙) carrying a set of proxy threads. */
function ownedEvent(
  threads: ArcadeCommunityProxyThread[],
  hasCompanion: boolean
): ArcadeCommunityFeedItem {
  return {
    id: 'e-owned',
    template: 'leaderboard_entry',
    public_label: 'Player 53CD',
    at: new Date(Date.now() - 12 * 60_000).toISOString(),
    like_count: 6,
    liked: false,
    threads,
    viewer_is_owner: true,
    viewer_has_companion: hasCompanion,
  }
}

const feedOf = (item: ArcadeCommunityFeedItem) => ({
  kind: 'ok' as const,
  feed: { items: [item], next_before: null },
})

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
    mockedReply.mockReset()
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

  it('renders a sealed proxy thread (passer-by view) with both signatures and the seal', async () => {
    const passerByCard: ArcadeCommunityFeedItem = {
      ...ownedEvent([SEALED_THREAD], false),
      viewer_is_owner: false,
    }
    mockedFetch.mockResolvedValue(feedOf(passerByCard))
    renderPage()

    // Author line + reply line, each signed「伙伴名 ✦ 主人昵称 的伙伴」.
    expect(await screen.findByText('阿澈')).toBeInTheDocument()
    expect(screen.getByText('蒙奇奇0605 的伙伴')).toBeInTheDocument()
    expect(screen.getByText('看到你上榜，替她道句漂亮。')).toBeInTheDocument()
    expect(screen.getByText('小满')).toBeInTheDocument()
    expect(screen.getByText('Player 53CD 的伙伴')).toBeInTheDocument()
    expect(screen.getByText('这句真稳，我替他收下了。')).toBeInTheDocument()
    // The round is complete → the seal, no reply CTA.
    expect(screen.getByText(/一轮对话已完成/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /让我的伙伴回一句/ })).not.toBeInTheDocument()
    // Passer-by is not the owner → no corner badge.
    expect(screen.queryByText(/伙伴留言/)).not.toBeInTheDocument()
  })

  it('shows the owner badge + one-tap reply CTA on an owned, unanswered thread', async () => {
    authState.current = {
      status: 'authed',
      user: { user_id: 'u1', email: 'u@x.com', displayName: 'u', avatarLetter: 'U' },
    }
    mockedFetch.mockResolvedValue(feedOf(ownedEvent([OPEN_THREAD], true)))
    renderPage()

    expect(await screen.findByRole('button', { name: /让我的伙伴回一句/ })).toBeInTheDocument()
    expect(screen.getByText(/伙伴留言 1/)).toBeInTheDocument()
  })

  it('shows the companion-onboarding guide when the owner has no companion', async () => {
    authState.current = {
      status: 'authed',
      user: { user_id: 'u1', email: 'u@x.com', displayName: 'u', avatarLetter: 'U' },
    }
    const noCompanionThread: ArcadeCommunityProxyThread = {
      ...OPEN_THREAD,
      can_reply: false,
    }
    mockedFetch.mockResolvedValue(feedOf(ownedEvent([noCompanionThread], false)))
    renderPage()

    expect(await screen.findByRole('link', { name: /创建你的伙伴来回应/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /让我的伙伴回一句/ })).not.toBeInTheDocument()
  })

  it('shows the login invite to an anonymous passer-by on an unanswered thread', async () => {
    const anonCard: ArcadeCommunityFeedItem = {
      ...ownedEvent([{ ...OPEN_THREAD, can_reply: false }], false),
      viewer_is_owner: false,
    }
    mockedFetch.mockResolvedValue(feedOf(anonCard))
    renderPage()

    expect(await screen.findByText(/登录，让你的伙伴回应/)).toBeInTheDocument()
  })

  it('replies on tap and seals the thread after the refetch (happy path)', async () => {
    authState.current = {
      status: 'authed',
      user: { user_id: 'u1', email: 'u@x.com', displayName: 'u', avatarLetter: 'U' },
    }
    // Initial feed = open thread; the post-reply refetch returns it sealed.
    mockedFetch
      .mockResolvedValueOnce(feedOf(ownedEvent([OPEN_THREAD], true)))
      .mockResolvedValueOnce(feedOf(ownedEvent([SEALED_OF_OPEN], true)))
    mockedReply.mockResolvedValue({ kind: 'ok' })
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: /让我的伙伴回一句/ }))

    expect(mockedReply).toHaveBeenCalledWith('m-open')
    expect(await screen.findByText(/一轮对话已完成/)).toBeInTheDocument()
    expect(screen.getByText('这句真稳，我替他收下了。')).toBeInTheDocument()
  })

  it('maps a 409 already-replied to a quiet note and refetches', async () => {
    authState.current = {
      status: 'authed',
      user: { user_id: 'u1', email: 'u@x.com', displayName: 'u', avatarLetter: 'U' },
    }
    mockedFetch
      .mockResolvedValueOnce(feedOf(ownedEvent([OPEN_THREAD], true)))
      .mockResolvedValueOnce(feedOf(ownedEvent([SEALED_OF_OPEN], true)))
    mockedReply.mockResolvedValue({ kind: 'already-replied' })
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: /让我的伙伴回一句/ }))

    expect(await screen.findByText(/已经回复过了/)).toBeInTheDocument()
  })

  it('turns the CTA into a disabled terminal state after a 410 (anchor aged out)', async () => {
    authState.current = {
      status: 'authed',
      user: { user_id: 'u1', email: 'u@x.com', displayName: 'u', avatarLetter: 'U' },
    }
    // out-of-window keeps the (now stale) card; the CTA becomes disabled「已过期」,
    // never a re-tappable no-op — so no refetch.
    mockedFetch.mockResolvedValue(feedOf(ownedEvent([OPEN_THREAD], true)))
    mockedReply.mockResolvedValue({ kind: 'out-of-window' })
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: /让我的伙伴回一句/ }))

    const terminal = await screen.findByRole('button', { name: '已过期' })
    expect(terminal).toBeDisabled()
    // The original CTA is gone (not re-tappable).
    expect(screen.queryByRole('button', { name: /让我的伙伴回一句/ })).not.toBeInTheDocument()
    // Only the initial feed read fired — no wholesale refetch on 410.
    expect(mockedFetch).toHaveBeenCalledTimes(1)
  })

  it('stacks multiple author threads under one card with independent per-thread state', async () => {
    authState.current = {
      status: 'authed',
      user: { user_id: 'u1', email: 'u@x.com', displayName: 'u', avatarLetter: 'U' },
    }
    const sealed: ArcadeCommunityProxyThread = {
      ...SEALED_THREAD,
      message_id: 'm-1',
      author_companion_name: '阿澈',
    }
    const openB: ArcadeCommunityProxyThread = {
      ...OPEN_THREAD,
      message_id: 'm-2',
      author_companion_name: '小柚',
    }
    const openC: ArcadeCommunityProxyThread = {
      ...OPEN_THREAD,
      message_id: 'm-3',
      author_companion_name: '木木',
    }
    mockedFetch.mockResolvedValue(feedOf(ownedEvent([sealed, openB, openC], true)))
    renderPage()

    // Badge counts every thread; all three authors render.
    expect(await screen.findByText(/伙伴留言 3/)).toBeInTheDocument()
    expect(screen.getByText('阿澈')).toBeInTheDocument()
    expect(screen.getByText('小柚')).toBeInTheDocument()
    expect(screen.getByText('木木')).toBeInTheDocument()

    // Per-thread can_reply independence: the sealed thread shows the seal (no
    // CTA); each open thread gets its own reply CTA.
    const ctas = screen.getAllByRole('button', { name: /让我的伙伴回一句/ })
    expect(ctas).toHaveLength(2)
    const seal = screen.getByText(/一轮对话已完成/)
    // Order: the sealed thread (first in threads[]) renders before the open CTAs.
    expect(seal.compareDocumentPosition(ctas[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('force-refetches the feed when arriving via the dock anchor (?event=)', async () => {
    mockedFetch.mockResolvedValue(feedOf(ownedEvent([SEALED_THREAD], false)))

    function GoAnchor() {
      const navigate = useNavigate()
      return (
        <button type="button" onClick={() => navigate('/community?event=e-owned')}>
          go
        </button>
      )
    }
    render(
      <MemoryRouter initialEntries={['/community']}>
        <Routes>
          <Route
            path="/community"
            element={
              <>
                <CommunityPage />
                <GoAnchor />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    )

    // Initial mount read.
    await screen.findByText('阿澈')
    expect(mockedFetch).toHaveBeenCalledTimes(1)

    // Navigating to the same route with the event anchor must re-read the feed
    // (never land on the stale cache missing the just-authored thread).
    fireEvent.click(screen.getByRole('button', { name: 'go' }))
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(2))

    // The anchored card carries the focus highlight.
    const card = screen.getByText('Player 53CD').closest('article')
    expect(card?.className).toMatch(/focused/)
  })
})
