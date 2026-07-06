/**
 * Node-level tests for the dev-shell wiring: role listing, log recording,
 * a full scripted playthrough to the win, invalid actions, and restart.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadGameType, loadLevel } from '../src/schema/load'
import { DevShellStore } from './store'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'radio-cipher')
const gameType = loadGameType(readFileSync(join(fixturesDir, 'game-type.yaml'), 'utf8'))
const level = loadLevel(readFileSync(join(fixturesDir, 'level.rc-demo-001.yaml'), 'utf8'))

describe('DevShellStore', () => {
  it('lists roles and role-scoped actions from vocabulary data', () => {
    const store = new DevShellStore(gameType, level)
    expect(store.roleIds()).toEqual(['listener', 'decoder'])
    expect(store.actionsFor('listener').map((a) => a.name)).toEqual([
      'describe_heard_content',
      'execute_decryption',
    ])
    expect(store.actionsFor('decoder').map((a) => a.name)).toEqual(['give_instruction'])
    expect(store.hasEventMapping()).toBe(false)
  })

  it('plays through to the win and records the log', () => {
    const store = new DevShellStore(gameType, level)
    store.perform('listener', 'execute_decryption', { element_id: 'seg-1' })
    store.perform('listener', 'execute_decryption', { element_id: 'seg-1' })
    expect(store.won()).toBe(false)
    store.perform('listener', 'execute_decryption', { element_id: 'seg-2' })
    expect(store.won()).toBe(true)
    expect(store.stateOf('seg-1').decryption_progress).toBe('decrypted')
    expect(store.stateOf('seg-2').decryption_progress).toBe('decrypted')
    expect(store.log()).toHaveLength(3)
    expect(store.log().every((entry) => entry.ok)).toBe(true)
  })

  it('logs invalid actions as failures without state drift', () => {
    const store = new DevShellStore(gameType, level)
    const before = JSON.stringify(store.stateOf('seg-1'))
    store.perform('decoder', 'execute_decryption', { element_id: 'seg-1' })
    expect(store.log()[0].ok).toBe(false)
    expect(store.log()[0].detail).toContain('cannot perform')
    expect(JSON.stringify(store.stateOf('seg-1'))).toBe(before)
  })

  it('restart resets session state and the log', () => {
    const store = new DevShellStore(gameType, level)
    store.perform('listener', 'execute_decryption', { element_id: 'seg-1' })
    store.reset()
    expect(store.log()).toHaveLength(0)
    expect(store.stateOf('seg-1').decryption_progress).toBe('encrypted')
    expect(store.won()).toBe(false)
  })
})
