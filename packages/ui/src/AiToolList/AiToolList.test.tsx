/**
 * AiToolList unit tests.
 *
 * Guards the canonical AI-tools rendering (DesignSystem.md §Brand → AI-Tools
 * List): both variants render the single `AI_TOOLS` source — `inline` joins
 * the names with ` · ` and emphasizes each in its own span; `chips` renders
 * one discrete brand pill per name.
 *
 * Note on casing: the all-caps guard (`text-transform: none` on the tool
 * spans, so an uppercasing parent eyebrow can't render `CLAUDE`) is a CSS rule.
 * jsdom does not apply stylesheet styles, so it can't be asserted here — these
 * tests assert the DOM text is the title-case `AI_TOOLS` array; the visual
 * casing guard is verified in the browser.
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import AiToolList, { AI_TOOLS } from './AiToolList'

describe('AiToolList', () => {
  it('renders AI_TOOLS inline, each name in its own emphasis span', () => {
    const { container } = render(<AiToolList variant="inline" />)

    // The whole inline string is AI_TOOLS joined by ` · `.
    expect(container.textContent).toBe(AI_TOOLS.join(' · '))

    // Each tool name renders in its own <span> (the weight-500 emphasis span).
    for (const tool of AI_TOOLS) {
      expect(screen.getByText(tool).tagName).toBe('SPAN')
    }
  })

  it('renders one title-case brand chip per AI_TOOLS entry in the chips variant', () => {
    const { container } = render(<AiToolList variant="chips" />)

    // One pill per tool.
    for (const tool of AI_TOOLS) {
      expect(screen.getByText(tool).tagName).toBe('SPAN')
    }

    // Chips are discrete pills — no ` · ` text separators between the names.
    expect(container.textContent).toBe(AI_TOOLS.join(''))
  })
})
