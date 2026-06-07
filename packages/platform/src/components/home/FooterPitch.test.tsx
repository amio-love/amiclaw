/**
 * FooterPitch tests.
 *
 * The product is anonymous-by-design (roadmap: nickname + device fingerprint,
 * no login or registration). The footer pitch is now a pure pitch block — no
 * play CTA of its own (the homepage routes to /bombsquad/ only via the hero +
 * TopNav). It just renders the headline and the no-signup / no-tracking promise:
 *   1. the headline renders
 *   2. the no-signup / no-tracking promise renders
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import FooterPitch from './FooterPitch'

describe('FooterPitch', () => {
  it('renders the headline and the no-signup promise', () => {
    render(<FooterPitch />)

    expect(screen.getByText(/找个人，找一只 AI/)).toBeInTheDocument()
    expect(screen.getByText('永久免费，不存档也不出售你的对话。')).toBeInTheDocument()
  })
})
