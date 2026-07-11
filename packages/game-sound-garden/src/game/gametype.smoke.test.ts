import { describe, expect, it } from 'vitest'
import { GameSession } from '@amiclaw/creation'
import { SOUND_GARDEN_GAME_TYPE } from './gametype'

describe('cross-package resolution smoke test', () => {
  it('loads the sound-garden GameType from the creation fixture', () => {
    expect(SOUND_GARDEN_GAME_TYPE.id).toBe('sound-garden')
    expect(SOUND_GARDEN_GAME_TYPE.co_play_form).toBe('co_build')
  })

  it('can import the real GameSession class', () => {
    expect(typeof GameSession).toBe('function')
  })
})
