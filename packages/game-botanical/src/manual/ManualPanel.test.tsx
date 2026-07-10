import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import ManualPanel from './ManualPanel'
import { renderBotanicalManual } from './render-manual'
import { botanicalGameType, tutorialLevel } from '@/data/load'

describe('ManualPanel', () => {
  it('renders every manual section with its title and lines', () => {
    const manual = renderBotanicalManual(botanicalGameType, tutorialLevel)
    render(<ManualPanel manual={manual} />)

    expect(screen.getByRole('heading', { level: 1, name: '养护手册' })).toBeInTheDocument()
    // every section heading is present
    for (const s of manual.sections) {
      expect(screen.getByRole('heading', { level: 2, name: s.title })).toBeInTheDocument()
    }
    // section blocks are addressable by id in the DOM
    const compatibility = document.querySelector('[data-section-id="compatibility"]')
    expect(compatibility).not.toBeNull()
    expect(within(compatibility as HTMLElement).getByText(/蕨类.*相克/)).toBeInTheDocument()
  })
})
