import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { App } from '../App'

describe('UI smoke', () => {
  beforeEach(() => {
    // Hermetic: the App probes /api/capabilities on mount. Report no keys →
    // scripted brain + NullVoice (Round A behavior), no real network.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ deepseek: false, doubao: false })))
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  it('renders the level select with three levels and a side toggle', () => {
    render(<App />)
    expect(screen.getByText(/声音花园/)).toBeInTheDocument()
    expect(screen.getByText('学步')).toBeInTheDocument()
    expect(screen.getByText('取舍')).toBeInTheDocument()
    expect(screen.getByText('荆棘')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '选择你的角色' })).toBeInTheDocument()
  })

  it('starts a level and shows the play screen with the partner greeting', async () => {
    render(<App />)
    fireEvent.click(screen.getByText('学步'))
    // Transport renders synchronously; the greeting arrives after the async opening turn.
    expect(await screen.findByText('▶ 播放')).toBeInTheDocument()
    expect(screen.getByText('园丁伙伴')).toBeInTheDocument()
    // The greeting arrives from the async opening partner turn.
    expect(await screen.findByText(/一起让花园唱起来/)).toBeInTheDocument()
    // The player palette shows the melody pool (default melody side).
    expect(screen.getByLabelText(/选择铃铛/)).toBeInTheDocument()
  })
})
