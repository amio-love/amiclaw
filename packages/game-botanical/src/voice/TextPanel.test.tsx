import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import TextPanel from './TextPanel'

describe('TextPanel', () => {
  it('sends the typed question and clears the input', () => {
    const onSend = vi.fn()
    render(<TextPanel onSend={onSend} disabled={false} />)
    const input = screen.getByLabelText('给植物学家的问题') as HTMLInputElement
    fireEvent.change(input, { target: { value: '兰花能浇水吗' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    expect(onSend).toHaveBeenCalledWith('兰花能浇水吗')
    expect(input.value).toBe('')
  })

  it('does not send an empty / whitespace question', () => {
    const onSend = vi.fn()
    render(<TextPanel onSend={onSend} disabled={false} />)
    const input = screen.getByLabelText('给植物学家的问题')
    fireEvent.change(input, { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled()
    fireEvent.submit(input.closest('form') as HTMLFormElement)
    expect(onSend).not.toHaveBeenCalled()
  })

  it('is disabled until the session is live', () => {
    render(<TextPanel onSend={vi.fn()} disabled />)
    expect(screen.getByLabelText('给植物学家的问题')).toBeDisabled()
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled()
  })
})
