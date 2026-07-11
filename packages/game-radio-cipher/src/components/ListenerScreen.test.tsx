/**
 * @vitest-environment jsdom
 *
 * SegmentCard submit-debounce contract: one gesture charges exactly one
 * wrong-answer penalty. A fast double-click / Enter+click both reach submit()
 * before React re-renders, so the guard is a synchronous ref set before the
 * onSubmit call. The lock releases after the shake window so a genuine retry
 * still registers. Rendered in jsdom; onSubmit is a spy (no engine, no audio).
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TUTORIAL_SEGMENTS } from '../content/tutorial-level'
import { SegmentCard } from './ListenerScreen'

const segment = TUTORIAL_SEGMENTS[0]

function typeWrongGuess(): HTMLButtonElement {
  fireEvent.change(screen.getByLabelText(`${segment.label} 解密答案`), {
    target: { value: '错' },
  })
  return screen.getByRole('button', { name: '发报确认' }) as HTMLButtonElement
}

describe('SegmentCard submit debounce', () => {
  afterEach(() => vi.useRealTimers())

  it('charges only one penalty for a double-click wrong answer', () => {
    const onSubmit = vi.fn().mockReturnValue({ ok: false, reason: 'wrong' })
    render(
      <SegmentCard segment={segment} progress={undefined} onListen={() => {}} onSubmit={onSubmit} />
    )
    const confirm = typeWrongGuess()
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(confirm.disabled).toBe(true)
  })

  it('re-enables after the feedback window so a real retry still counts', () => {
    vi.useFakeTimers()
    const onSubmit = vi.fn().mockReturnValue({ ok: false, reason: 'wrong' })
    render(
      <SegmentCard segment={segment} progress={undefined} onListen={() => {}} onSubmit={onSubmit} />
    )
    const confirm = typeWrongGuess()
    fireEvent.click(confirm)
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(confirm.disabled).toBe(true)

    act(() => {
      vi.advanceTimersByTime(420)
    })
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)
    expect(onSubmit).toHaveBeenCalledTimes(2)
  })
})
