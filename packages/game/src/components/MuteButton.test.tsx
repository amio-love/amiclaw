/**
 * Component tests for MuteButton.
 *
 * jsdom's `localStorage` is method-less in this workspace, so a Map-backed
 * fake is installed per test (see `src/utils/nickname.test.ts` for the
 * precedent). The mute store is a module singleton; `setMuted(false)` in
 * `beforeEach` resets it to a known state between tests.
 */
import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import MuteButton from './MuteButton'
import { setMuted, isMuted } from '@/audio/mute'

const STORAGE_KEY = 'bombsquad:audio-muted'

function installFakeLocalStorage() {
  const store = new Map<string, string>()
  const fake = {
    getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value))
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
    get length() {
      return store.size
    },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
  }
  vi.stubGlobal('localStorage', fake)
  return store
}

describe('MuteButton', () => {
  let store: Map<string, string>

  beforeEach(() => {
    store = installFakeLocalStorage()
    setMuted(false)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders unmuted by default with audible-state aria', () => {
    render(<MuteButton />)
    const btn = screen.getByRole('button')
    expect(btn).toHaveAttribute('aria-pressed', 'false')
    expect(btn).toHaveAttribute('aria-label', '静音')
  })

  it('toggles to muted on click and persists the preference', () => {
    render(<MuteButton />)
    const btn = screen.getByRole('button')
    fireEvent.click(btn)
    expect(btn).toHaveAttribute('aria-pressed', 'true')
    expect(btn).toHaveAttribute('aria-label', '取消静音')
    expect(isMuted()).toBe(true)
    expect(store.get(STORAGE_KEY)).toBe('true')
  })

  it('toggles back to unmuted on a second click', () => {
    render(<MuteButton />)
    const btn = screen.getByRole('button')
    fireEvent.click(btn)
    fireEvent.click(btn)
    expect(btn).toHaveAttribute('aria-pressed', 'false')
    expect(isMuted()).toBe(false)
  })

  it('reflects mute changes made outside the component', () => {
    render(<MuteButton />)
    const btn = screen.getByRole('button')
    expect(btn).toHaveAttribute('aria-pressed', 'false')
    act(() => setMuted(true))
    expect(btn).toHaveAttribute('aria-pressed', 'true')
  })

  it('applies the className supplied by the host page', () => {
    render(<MuteButton className="host-class" />)
    expect(screen.getByRole('button')).toHaveClass('host-class')
  })
})
