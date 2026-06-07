/**
 * FooterPitch CTA tests.
 *
 * The product is anonymous-by-design (roadmap: nickname + device fingerprint,
 * no login or registration), so the footer pitch CTA must read honestly — no
 * label that implies a registration step that does not exist:
 *   1. the CTA reads as an honest "no signup, just play" entry
 *   2. clicking it fires onRegister (the existing /bombsquad/ routing)
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import FooterPitch from './FooterPitch'

describe('FooterPitch', () => {
  it('renders an honest no-signup play CTA', () => {
    render(<FooterPitch onRegister={() => {}} />)

    expect(screen.getByRole('button', { name: '免注册，直接开始玩' })).toBeInTheDocument()
    // The old dishonest registration label must be gone.
    expect(screen.queryByText('注册 · 30 秒')).not.toBeInTheDocument()
  })

  it('fires onRegister when the CTA is clicked', () => {
    const onRegister = vi.fn()
    render(<FooterPitch onRegister={onRegister} />)

    fireEvent.click(screen.getByRole('button', { name: '免注册，直接开始玩' }))

    expect(onRegister).toHaveBeenCalledTimes(1)
  })
})
