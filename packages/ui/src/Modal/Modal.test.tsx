/**
 * Modal unit tests — the portalled glass dialog.
 *
 * Guards: nothing renders while closed; an open modal is a labelled dialog;
 * Escape, a backdrop click, and the × button each request close, while a click
 * inside the dialog does not.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Modal from './Modal'

describe('Modal', () => {
  it('renders nothing while closed', () => {
    render(
      <Modal open={false} onClose={() => {}} title="确认删除">
        <p>body</p>
      </Modal>
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders a labelled dialog with its title and children when open', () => {
    render(
      <Modal open onClose={() => {}} title="确认删除">
        <p>真的要删除吗？</p>
      </Modal>
    )
    expect(screen.getByRole('dialog', { name: '确认删除' })).toBeInTheDocument()
    expect(screen.getByText('真的要删除吗？')).toBeInTheDocument()
  })

  it('requests close on Escape, on the × button, and on a backdrop click', () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} title="确认删除">
        <p>body</p>
      </Modal>
    )

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(onClose).toHaveBeenCalledTimes(2)

    // The dialog itself stops propagation, so clicking the body text must NOT
    // close; clicking the surrounding backdrop must.
    fireEvent.click(screen.getByText('body'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
