/**
 * useGreetingName tests — the unified username (ruling A).
 *
 * ONE name sitewide, based on the public leaderboard handle (the board
 * nickname). The companion-given intimate name (`address_style`) NEVER appears
 * in the greeting — it belongs only to companion surfaces. So the greeting is
 * the board nickname, or a neutral null when none is set; a companion name can
 * no longer surface here (the U3 split fix).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  nickname: undefined as string | undefined,
}))

vi.mock('@/lib/arcade-nickname', () => ({
  readChosenArcadeNickname: () => mocks.nickname,
}))

import { useGreetingName } from './useGreetingName'

afterEach(() => {
  mocks.nickname = undefined
})

describe('useGreetingName — unified username (ruling A)', () => {
  it('greets by the board nickname (the public leaderboard handle)', () => {
    mocks.nickname = '审计员07'
    const { result } = renderHook(() => useGreetingName())
    expect(result.current).toBe('审计员07')
  })

  it('is neutral (null) when no username is set — never a companion intimate name', () => {
    mocks.nickname = undefined
    const { result } = renderHook(() => useGreetingName())
    expect(result.current).toBeNull()
  })
})
