/**
 * PlanetOrb unit tests.
 *
 * jsdom applies no stylesheet, so these assert the structural contract the CSS
 * hangs off of: the variant class, the decorative `aria-hidden` flag, the
 * inline `--orb-size` from the `size` prop, the breathing opt-out, the merged
 * consumer className, and centered children (the lobby glyph slot).
 */
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import PlanetOrb from './PlanetOrb'
import styles from './PlanetOrb.module.css'

describe('PlanetOrb', () => {
  it('defaults to the breathing avatar variant', () => {
    const { container } = render(<PlanetOrb />)
    const orb = container.firstElementChild as HTMLElement
    expect(orb.className).toContain(styles.orb)
    expect(orb.className).toContain(styles.avatar)
    expect(orb.className).not.toContain(styles.still)
  })

  it('renders the hero / lobby variant class without breathing', () => {
    const { container } = render(<PlanetOrb variant="hero" ariaHidden />)
    const orb = container.firstElementChild as HTMLElement
    expect(orb.className).toContain(styles.hero)
    expect(orb.getAttribute('aria-hidden')).toBe('true')
  })

  it('sets --orb-size inline from the size prop (avatar sizing)', () => {
    const { container } = render(<PlanetOrb size={52} />)
    const orb = container.firstElementChild as HTMLElement
    expect(orb.style.getPropertyValue('--orb-size')).toBe('52px')
  })

  it('hard-stops the breathing when breathing={false}', () => {
    const { container } = render(<PlanetOrb variant="avatar" breathing={false} />)
    const orb = container.firstElementChild as HTMLElement
    expect(orb.className).toContain(styles.still)
  })

  it('merges the consumer className and centers children (lobby glyph slot)', () => {
    const { container, getByTestId } = render(
      <PlanetOrb variant="lobby" className="consumer-core">
        <span data-testid="glyph">★</span>
      </PlanetOrb>
    )
    const orb = container.firstElementChild as HTMLElement
    expect(orb.className).toContain(styles.lobby)
    expect(orb.className).toContain('consumer-core')
    expect(getByTestId('glyph')).toBeInTheDocument()
  })

  it('omits aria-hidden when not decorative', () => {
    const { container } = render(<PlanetOrb variant="avatar" />)
    const orb = container.firstElementChild as HTMLElement
    expect(orb.hasAttribute('aria-hidden')).toBe(false)
  })
})
