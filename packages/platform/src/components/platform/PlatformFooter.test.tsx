/**
 * PlatformFooter link-wiring test.
 *
 * 隐私 and 条款 must be real react-router links to /privacy and /terms; 关于
 * and Discord are owned by a sibling task and must stay non-link dead text
 * until their destinations land. This test pins both halves of that contract.
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import PlatformFooter from './PlatformFooter'

function renderFooter() {
  return render(
    <MemoryRouter>
      <PlatformFooter />
    </MemoryRouter>
  )
}

describe('PlatformFooter', () => {
  it('renders 隐私 as a link to /privacy', () => {
    renderFooter()
    const link = screen.getByRole('link', { name: '隐私' })
    expect(link).toHaveAttribute('href', '/privacy')
  })

  it('renders 条款 as a link to /terms', () => {
    renderFooter()
    const link = screen.getByRole('link', { name: '条款' })
    expect(link).toHaveAttribute('href', '/terms')
  })

  it('keeps 关于 and Discord as non-link dead text (owned by a sibling task)', () => {
    renderFooter()
    expect(screen.queryByRole('link', { name: '关于' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Discord' })).not.toBeInTheDocument()
    // They still render as text.
    expect(screen.getByText('关于')).toBeInTheDocument()
    expect(screen.getByText('Discord')).toBeInTheDocument()
  })
})
