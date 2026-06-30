/**
 * MemoryAlbumPage (/me/memories) integration tests.
 *
 *   1. an honest empty state (no「即将推出」) when there are no memories;
 *   2. the album lists episode cards;
 *   3. deleting a memory confirms, then removes the card on success;
 *   4. an evidence click-back (?focus=) auto-paginates to land an episode that
 *      lives beyond the first keyset page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { MemoryView } from '@shared/companion-types'
import MemoryAlbumPage from './MemoryAlbumPage'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

// jsdom does not implement scrollIntoView; a focused MemoryCard calls it.
beforeEach(() => {
  Element.prototype.scrollIntoView = () => {}
})

const AUTHED = { authenticated: true, identity: { user_id: 'u_1', email: 'nova@amio.fans' } }

const MEMORIES: MemoryView[] = [
  {
    id: 'ep-1',
    occurred_at: '2026-06-28T21:40:00.000Z',
    game_id: 'bombsquad',
    title: '最后三秒拆掉了炸弹',
    narrative: '你在最后三秒剪断了那根红线。',
  },
  {
    id: 'ep-2',
    occurred_at: '2026-06-02T19:30:00.000Z',
    game_id: 'bombsquad',
    title: '第一次通关每日挑战',
    narrative: '我们第一次一起拆完了四个模块。',
  },
]

function stubServer(memories: MemoryView[]) {
  const live = [...memories]
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url.includes('/api/auth/session')) return Promise.resolve(json(AUTHED))
      if (url.includes('/api/companion/memories/') && method === 'DELETE') {
        return Promise.resolve(json({ ok: true }))
      }
      if (url.includes('/api/companion/memories')) {
        return Promise.resolve(json({ memories: live }))
      }
      return Promise.resolve(json({}, 404))
    })
  )
}

function renderAlbum() {
  return render(
    <MemoryRouter initialEntries={['/me/memories']}>
      <Routes>
        <Route path="/me/memories" element={<MemoryAlbumPage />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('MemoryAlbumPage /me/memories', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows an honest empty state with no「即将推出」', async () => {
    stubServer([])
    renderAlbum()

    expect(await screen.findByText('还没有回忆')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '开始玩' })).toBeInTheDocument()
    expect(screen.queryByText(/即将推出/)).not.toBeInTheDocument()
    expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument()
  })

  it('lists episode cards', async () => {
    stubServer(MEMORIES)
    renderAlbum()

    expect(await screen.findByText('最后三秒拆掉了炸弹')).toBeInTheDocument()
    expect(screen.getByText('第一次通关每日挑战')).toBeInTheDocument()
  })

  it('deletes a memory after confirmation', async () => {
    stubServer(MEMORIES)
    renderAlbum()

    fireEvent.click(await screen.findByRole('button', { name: '删除回忆「最后三秒拆掉了炸弹」' }))

    // Confirm in the dialog.
    const dialog = await screen.findByRole('dialog', { name: '删除这段回忆？' })
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }))

    // The card is gone; the other memory survives.
    await screen.findByText('第一次通关每日挑战')
    expect(screen.queryByText('最后三秒拆掉了炸弹')).not.toBeInTheDocument()
  })

  it('auto-paginates so an evidence click-back lands an episode on page 2', async () => {
    // page 1 = MEMORIES (+ a cursor); page 2 = the focused episode ep-3.
    const PAGE2: MemoryView = {
      id: 'ep-3',
      occurred_at: '2026-05-10T18:00:00.000Z',
      game_id: 'bombsquad',
      title: '更早的那一局',
      narrative: '一段更久以前的回忆。',
    }
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/api/auth/session')) return Promise.resolve(json(AUTHED))
        if (url.includes('/api/companion/memories')) {
          if (url.includes('cursor=c1')) return Promise.resolve(json({ memories: [PAGE2] }))
          return Promise.resolve(json({ memories: MEMORIES, next_cursor: 'c1' }))
        }
        return Promise.resolve(json({}, 404))
      })
    )

    render(
      <MemoryRouter initialEntries={['/me/memories?focus=ep-3']}>
        <Routes>
          <Route path="/me/memories" element={<MemoryAlbumPage />} />
        </Routes>
      </MemoryRouter>
    )

    // ep-3 lives on page 2; it appears without the player clicking 看更早的回忆.
    expect(await screen.findByText('更早的那一局')).toBeInTheDocument()
    expect(screen.getByText('最后三秒拆掉了炸弹')).toBeInTheDocument()
  })
})
