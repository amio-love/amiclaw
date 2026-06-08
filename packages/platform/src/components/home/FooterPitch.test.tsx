/**
 * FooterPitch tests.
 *
 * The product is anonymous-by-design (roadmap: nickname + device fingerprint,
 * no login or registration). The footer pitch is now a pure pitch block — no
 * play CTA of its own (the homepage routes to /bombsquad/ only via the hero +
 * TopNav). It just renders the closing headline:
 *   1. the headline renders
 *   2. the old no-signup / no-tracking promise no longer renders here
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import FooterPitch from './FooterPitch'

describe('FooterPitch', () => {
  it('renders the headline without the old no-signup promise', () => {
    render(<FooterPitch />)

    expect(screen.getByText(/带上你的 AI/)).toBeInTheDocument()
    expect(screen.queryByText(/找个人/)).not.toBeInTheDocument()
    expect(screen.queryByText('永久免费，不存档也不出售你的对话。')).not.toBeInTheDocument()
  })
})
