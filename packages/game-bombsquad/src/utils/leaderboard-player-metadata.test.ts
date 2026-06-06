import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LEADERBOARD_AI_MODEL_MAX_LENGTH,
  LEADERBOARD_AI_TOOL_MAX_LENGTH,
  getStoredLeaderboardPlayerMetadata,
  isValidLeaderboardAiTool,
  normalizeLeaderboardAiModel,
  setStoredLeaderboardPlayerMetadata,
} from './leaderboard-player-metadata'

const AI_TOOL_KEY = 'bombsquad-leaderboard-ai-tool'
const AI_MODEL_KEY = 'bombsquad-leaderboard-ai-model'

interface FakeLocalStorageOverrides {
  getItem?: (key: string) => string | null
  setItem?: (key: string, value: string) => void
  removeItem?: (key: string) => void
}

function installFakeLocalStorage(overrides: FakeLocalStorageOverrides = {}) {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem:
      overrides.getItem ?? ((key: string) => (store.has(key) ? (store.get(key) as string) : null)),
    setItem:
      overrides.setItem ??
      ((key: string, value: string) => {
        store.set(key, String(value))
      }),
    removeItem:
      overrides.removeItem ??
      ((key: string) => {
        store.delete(key)
      }),
    clear: () => {
      store.clear()
    },
    get length() {
      return store.size
    },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
  })
  return store
}

describe('leaderboard player metadata', () => {
  beforeEach(() => {
    installFakeLocalStorage()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('requires a non-empty AI tool within the cap', () => {
    expect(isValidLeaderboardAiTool('Claude')).toBe(true)
    expect(isValidLeaderboardAiTool('  ChatGPT  ')).toBe(true)
    expect(isValidLeaderboardAiTool('')).toBe(false)
    expect(isValidLeaderboardAiTool('   ')).toBe(false)
    expect(isValidLeaderboardAiTool('a'.repeat(LEADERBOARD_AI_TOOL_MAX_LENGTH + 1))).toBe(false)
  })

  it('normalizes optional model text and omits blank values', () => {
    expect(normalizeLeaderboardAiModel('  Claude Sonnet 4.5  ')).toBe('Claude Sonnet 4.5')
    expect(normalizeLeaderboardAiModel('   ')).toBeUndefined()
    expect(normalizeLeaderboardAiModel(undefined)).toBeUndefined()
    expect(
      normalizeLeaderboardAiModel('a'.repeat(LEADERBOARD_AI_MODEL_MAX_LENGTH + 5))
    ).toHaveLength(LEADERBOARD_AI_MODEL_MAX_LENGTH)
  })

  it('stores and reads AI tool plus model', () => {
    expect(
      setStoredLeaderboardPlayerMetadata({ aiTool: '  claude  ', aiModel: '  Sonnet 4.5  ' })
    ).toBe(true)
    expect(localStorage.getItem(AI_TOOL_KEY)).toBe('claude')
    expect(localStorage.getItem(AI_MODEL_KEY)).toBe('Sonnet 4.5')
    expect(getStoredLeaderboardPlayerMetadata()).toEqual({
      aiTool: 'claude',
      aiModel: 'Sonnet 4.5',
    })
  })

  it('omits the model when it is blank', () => {
    localStorage.setItem(AI_MODEL_KEY, 'old model')
    expect(setStoredLeaderboardPlayerMetadata({ aiTool: 'gemini', aiModel: '   ' })).toBe(true)
    expect(localStorage.getItem(AI_MODEL_KEY)).toBeNull()
    expect(getStoredLeaderboardPlayerMetadata()).toEqual({ aiTool: 'gemini' })
  })

  it('returns null when the required AI tool is missing or corrupted', () => {
    expect(getStoredLeaderboardPlayerMetadata()).toBeNull()
    localStorage.setItem(AI_TOOL_KEY, 'a'.repeat(LEADERBOARD_AI_TOOL_MAX_LENGTH + 1))
    expect(getStoredLeaderboardPlayerMetadata()).toBeNull()
  })

  it('returns false when storage writes fail', () => {
    installFakeLocalStorage({
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    })
    expect(setStoredLeaderboardPlayerMetadata({ aiTool: 'claude' })).toBe(false)
  })
})
