/**
 * AccountPage (/me) integration tests.
 *
 * Regression guard for the bug where `/me` rendered a complete fake profile
 * to unauthenticated visitors. The page now branches on useAuth():
 *   1. signed-out `/me` renders a login-guide empty state (heading + a
 *      plain-text unlock preview + a functional CTA) and NONE of the fake
 *      profile content (no 林星海 / 星海, no 42, no「所有数据只属于你」copy,
 *      no recent-runs table, no badge grid).
 *   2. the signed-out CTA navigates to the platform homepage `/`.
 *   3. signed-in `/me` (?auth=in) renders the profile, 最近 5 局 and 勋章.
 *
 * Render the page directly inside a MemoryRouter. A sibling `/` route renders
 * a location probe so the CTA's navigation target is assertable without
 * mounting the real homepage. Auth is mock: `?auth=in` persists to
 * localStorage, so each test clears it first to start signed out.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import AccountPage from './AccountPage'

function renderAccount(entry = '/me') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/me" element={<AccountPage />} />
        <Route path="/" element={<div>HOME PROBE</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('AccountPage /me', () => {
  beforeEach(() => {
    // ?auth=in persists to localStorage; clear it so each test starts signed
    // out. The jsdom localStorage in this workspace can be non-functional —
    // ignore failures.
    try {
      localStorage.clear()
    } catch {
      // ignore storage failures (private mode, non-functional jsdom stub)
    }
  })

  it('renders the login guide and no fake profile for a signed-out visitor', () => {
    renderAccount('/me')

    // Login-guide markers: the heading and the plain-text unlock preview.
    expect(screen.getByText('登录后查看你的星轨')).toBeInTheDocument()
    expect(screen.getByText('战绩与单局完成率')).toBeInTheDocument()
    expect(screen.getByText('连胜与最快记录')).toBeInTheDocument()
    expect(screen.getByText('勋章墙')).toBeInTheDocument()
    // A functional CTA linking to the homepage.
    expect(screen.getByRole('link', { name: '登录 / 开始' })).toBeInTheDocument()

    // None of the fake-profile content may render for an anonymous visitor.
    expect(screen.queryByText('星海')).not.toBeInTheDocument()
    expect(screen.queryByText('林星海')).not.toBeInTheDocument()
    expect(screen.queryByText('42')).not.toBeInTheDocument()
    expect(
      screen.queryByText('你的战绩、连胜、个人最快记录。所有数据只属于你。')
    ).not.toBeInTheDocument()
    // The recent-runs table and the badge grid are absent.
    expect(screen.queryByText('最近 5 局')).not.toBeInTheDocument()
    expect(screen.queryByText('勋章')).not.toBeInTheDocument()
  })

  it('navigates to the homepage when the signed-out CTA is clicked', () => {
    renderAccount('/me')

    fireEvent.click(screen.getByRole('link', { name: '登录 / 开始' }))

    expect(screen.getByText('HOME PROBE')).toBeInTheDocument()
  })

  it('renders the profile, recent runs and badges for a signed-in visitor', () => {
    renderAccount('/me?auth=in')

    // Profile identity comes from the authenticated user (林 + 星海).
    expect(screen.getByText('林星海')).toBeInTheDocument()
    // Stats card surfaces the completed count.
    expect(screen.getByText('42')).toBeInTheDocument()
    // The 最近 5 局 table and 勋章 grid render.
    expect(screen.getByText('最近 5 局')).toBeInTheDocument()
    expect(screen.getByText('勋章')).toBeInTheDocument()
    // The login-guide empty state must NOT be present.
    expect(screen.queryByRole('link', { name: '登录 / 开始' })).not.toBeInTheDocument()
  })
})
