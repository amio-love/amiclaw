/**
 * useGreetingName precedence tests (F5).
 *
 * Two surface precedences:
 *   - board / account (default): board nickname → companion-known name → null;
 *   - companion (`preferCompanionName`): companion-known name → nickname → null.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  nickname: undefined as string | undefined,
  companionState: { status: 'none' } as
    | { status: 'none' | 'loading' | 'error' }
    | { status: 'exists'; companion: { address_style?: string } },
}))

vi.mock('@/lib/arcade-nickname', () => ({
  readChosenArcadeNickname: () => mocks.nickname,
}))
vi.mock('./useCompanion', () => ({
  useCompanion: () => ({ state: mocks.companionState }),
}))

import { useGreetingName } from './useGreetingName'

afterEach(() => {
  mocks.nickname = undefined
  mocks.companionState = { status: 'none' }
})

describe('useGreetingName — board/account precedence (default)', () => {
  it('leads with the board nickname even when a companion name exists', () => {
    mocks.nickname = '审计员07'
    mocks.companionState = { status: 'exists', companion: { address_style: '白舟' } }
    const { result } = renderHook(() => useGreetingName())
    expect(result.current).toBe('审计员07')
  })

  it('falls back to the companion name when no nickname is set', () => {
    mocks.companionState = { status: 'exists', companion: { address_style: '白舟' } }
    const { result } = renderHook(() => useGreetingName())
    expect(result.current).toBe('白舟')
  })
})

describe('useGreetingName — companion precedence (preferCompanionName)', () => {
  it('leads with the companion-known name even when a board nickname exists', () => {
    mocks.nickname = '审计员07'
    mocks.companionState = { status: 'exists', companion: { address_style: '白舟' } }
    const { result } = renderHook(() => useGreetingName(true))
    expect(result.current).toBe('白舟')
  })

  it('falls back to the board nickname when the companion has no address style', () => {
    mocks.nickname = '审计员07'
    mocks.companionState = { status: 'exists', companion: { address_style: '' } }
    const { result } = renderHook(() => useGreetingName(true))
    expect(result.current).toBe('审计员07')
  })

  it('is neutral (null) when neither a companion name nor a nickname exists', () => {
    mocks.companionState = { status: 'none' }
    const { result } = renderHook(() => useGreetingName(true))
    expect(result.current).toBeNull()
  })
})
