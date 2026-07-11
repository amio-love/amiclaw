import { describe, expect, it } from 'vitest'

import { resolveGameShortcut } from './keyboard-shortcuts'

describe('game keyboard shortcuts', () => {
  it('maps a non-repeating Space press outside controls to swap', () => {
    expect(resolveGameShortcut('Space', false, false)).toEqual({ type: 'swap' })
  })

  it('does not swap for repeats, focused controls, or movement keys', () => {
    expect(resolveGameShortcut('Space', true, false)).toBeUndefined()
    expect(resolveGameShortcut('Space', false, true)).toBeUndefined()
    expect(resolveGameShortcut('KeyW', false, false)).toBeUndefined()
  })
})
