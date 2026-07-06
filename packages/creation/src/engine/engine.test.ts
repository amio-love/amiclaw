/**
 * Engine tests: scripted full rc-demo-001 playthrough to win, wrong-action
 * robustness (no crash, state consistent), role-view leak guarantee, input
 * immutability, and the engine-backed solution search (a real found path).
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadGameType, loadLevel } from '../schema/load'
import { expandNames, startDeadline } from '../validate/helpers'
import { GameSession } from './engine'
import { searchSolution, solutionDriversForTarget } from './search'

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'fixtures',
  'radio-cipher'
)

const gameType = loadGameType(readFileSync(join(fixturesDir, 'game-type.yaml'), 'utf8'))
const level = loadLevel(readFileSync(join(fixturesDir, 'level.rc-demo-001.yaml'), 'utf8'))

describe('GameSession — scripted rc-demo-001 playthrough', () => {
  it('plays through to the win purely via declared vocabulary', () => {
    const session = new GameSession(gameType, level)
    expect(session.isWon()).toBe(false)
    expect(session.getState().elements['seg-1'].decryption_progress).toBe('encrypted')

    // The listener describes what they hear (no state effect), then executes
    // decryption per the decoder's instructions.
    expect(session.performAction('listener', 'describe_heard_content').ok).toBe(true)

    // seg-1: caesar shift — apply_key advances one step per execution.
    const first = session.performAction('listener', 'execute_decryption', {
      element_id: 'seg-1',
    })
    expect(first.ok).toBe(true)
    expect(session.getState().elements['seg-1'].decryption_progress).toBe('partial')
    session.performAction('listener', 'execute_decryption', { element_id: 'seg-1' })
    expect(session.getState().elements['seg-1'].decryption_progress).toBe('decrypted')
    expect(session.isWon()).toBe(false) // seg-2 still encrypted

    // seg-2: reverse decode — complete_state jumps to the terminal state.
    session.performAction('listener', 'execute_decryption', { element_id: 'seg-2' })
    expect(session.getState().elements['seg-2'].decryption_progress).toBe('decrypted')
    expect(session.isWon()).toBe(true)
    expect(session.getState().won).toBe(true)
  })

  it('handles wrong actions without crashing and without state drift', () => {
    const session = new GameSession(gameType, level)
    const before = JSON.stringify(session.getState())

    expect(session.performAction('listener', 'give_instruction')).toEqual({
      ok: false,
      reason: 'role "listener" cannot perform "give_instruction"',
    })
    expect(session.performAction('decoder', 'execute_decryption', { element_id: 'seg-1' }).ok).toBe(
      false
    )
    expect(session.performAction('listener', 'execute_decryption', { element_id: 'nope' }).ok).toBe(
      false
    )
    expect(session.performAction('listener', 'apply_key', { element_id: 'seg-1' })).toEqual({
      ok: false,
      reason: '"apply_key" is engine-internal (scope rule_verb)',
    })
    expect(session.performAction('listener', 'teleport').ok).toBe(false)

    expect(JSON.stringify(session.getState())).toBe(before)
  })

  it('F4: rejects malformed calls distinguishably from legitimate no-ops', () => {
    const session = new GameSession(gameType, level)

    // Unknown extra arg → malformed → reject (not a silent no-op).
    const unknown = session.performAction('listener', 'execute_decryption', {
      element_id: 'seg-1',
      bogus: 1,
    } as unknown as { element_id: string })
    expect(unknown.ok).toBe(false)
    expect(!unknown.ok && unknown.reason).toContain('unknown arg')

    // Legitimate communication no-op (no declared params, no construction
    // effect) → ok:true with empty effects (NOT a malformed rejection).
    const describe = session.performAction('listener', 'describe_heard_content')
    expect(describe.ok).toBe(true)
    expect(describe.ok && describe.effects).toEqual([])
  })

  it('never mutates the GameType or Level inputs', () => {
    const gameTypeBefore = JSON.stringify(gameType)
    const levelBefore = JSON.stringify(level)
    const session = new GameSession(gameType, level)
    session.performAction('listener', 'execute_decryption', { element_id: 'seg-1' })
    session.performAction('listener', 'execute_decryption', { element_id: 'seg-2' })
    session.getRoleView('listener')
    session.getRoleView('decoder')
    expect(JSON.stringify(gameType)).toBe(gameTypeBefore)
    expect(JSON.stringify(level)).toBe(levelBefore)
  })
})

describe('B: rule firing depends on WHICH action triggered it (F1 closure)', () => {
  it('spamming the pure-communication describe_heard_content NEVER advances a segment', () => {
    const session = new GameSession(gameType, level)
    // The exploit: call the params:[] communication action on seg-1 repeatedly.
    // It targets a cipher_segment (capability allows it) but triggers no rule.
    for (let i = 0; i < 5; i++) {
      const result = session.performAction('listener', 'describe_heard_content', {
        element_id: 'seg-1',
      })
      expect(result.ok).toBe(true) // a legitimate no-op, not a rejection…
      expect(result.ok && result.effects).toEqual([]) // …but nothing fires
    }
    expect(session.getState().elements['seg-1'].decryption_progress).toBe('encrypted')
    expect(session.isWon()).toBe(false) // no solo win
  })

  it('only the intended trigger action (execute_decryption) drives the pipeline', () => {
    const session = new GameSession(gameType, level)
    const decrypt = session.performAction('listener', 'execute_decryption', { element_id: 'seg-1' })
    expect(decrypt.ok && decrypt.effects).toContain('rule-decrypt-1: step applied')
    expect(session.getState().elements['seg-1'].decryption_progress).toBe('partial')
  })
})

describe('GameSession — role-filtered views', () => {
  const session = new GameSession(gameType, level)

  it('exposes the partitioned views each role plays from', () => {
    const listener = session.getRoleView('listener')
    expect(listener.elements.map((e) => e.element_id)).toEqual(['seg-1', 'seg-2'])
    expect(listener.elements[0].visible_params).toEqual({ content_length: 'short' })
    expect(listener.elements[0].visible_states).toEqual({ decryption_progress: 'encrypted' })
    expect(listener.visible_rules).toEqual([])
    expect(listener.can_perform).toEqual(['describe_heard_content', 'execute_decryption'])

    const decoder = session.getRoleView('decoder')
    expect(decoder.elements.map((e) => e.element_id)).toEqual([
      'key-1',
      'hint-1',
      'hint-2',
      'seg-1',
      'seg-2',
    ])
    expect(decoder.visible_rules).toEqual(['rule-decrypt-1', 'rule-reverse-2', 'rule-verify'])
    expect(decoder.can_perform).toEqual(['give_instruction'])
  })

  it('leak test: a role view NEVER contains a cannot_see field', () => {
    const template = gameType.information_partition_template
    if (!template) throw new Error('fixture partition template missing')
    for (const visibilityRule of template.visibility_rules) {
      const view = session.getRoleView(visibilityRule.role)
      for (const entry of visibilityRule.cannot_see) {
        const archetype = gameType.element_archetypes.find((a) => a.id === entry.element_archetype)
        if (!archetype) continue
        const forbiddenAttrs = expandNames(
          entry.attributes,
          archetype.attributes.map((a) => a.name)
        )
        const forbiddenStates = expandNames(
          entry.states,
          (archetype.states ?? []).map((s) => s.name)
        )
        for (const elementView of view.elements) {
          if (elementView.archetype !== entry.element_archetype) continue
          for (const attr of forbiddenAttrs) {
            expect(elementView.visible_params).not.toHaveProperty(attr)
          }
          for (const state of forbiddenStates) {
            expect(elementView.visible_states).not.toHaveProperty(state)
          }
        }
      }
    }
  })

  it('excludes cannot_see fields even when a level view over-declares them', () => {
    const leakyLevel = structuredClone(level)
    const listenerAssignment = leakyLevel.information_partition.role_assignments.find(
      (a) => a.role === 'listener'
    )
    if (!listenerAssignment) throw new Error('fixture role missing')
    // A malicious/buggy level view over-declares the hidden field.
    listenerAssignment.element_views[0].visible_attributes = [
      'content_length',
      'plaintext_category',
    ]
    const leakySession = new GameSession(gameType, leakyLevel)
    const view = leakySession.getRoleView('listener')
    expect(view.elements[0].visible_params).not.toHaveProperty('plaintext_category')
  })
})

describe('engine-backed solution search', () => {
  it('finds a real solution path for rc-demo-001', () => {
    const result = searchSolution(gameType, level)
    expect(result.solvable).toBe(true)
    expect(result.timedOut).toBe(false)
    expect(result.path.length).toBeGreaterThanOrEqual(3) // 2× decrypt steps + 1× reverse
    const ruleIds = new Set(level.rules.map((rule) => rule.id))
    for (const step of result.path) {
      expect(ruleIds).toContain(step)
    }
    expect(result.path).toContain('rule-decrypt-1')
    expect(result.path).toContain('rule-reverse-2')
  })

  it('counts exactly one independent driver per rc-demo target', () => {
    for (const targetId of ['seg-1', 'seg-2']) {
      const analysis = solutionDriversForTarget(gameType, level, targetId, startDeadline(5000))
      expect(analysis.timedOut).toBe(false)
      expect(analysis.drivers).toHaveLength(1)
    }
  })

  it('times out instead of fake-passing under a zero deadline', () => {
    const result = searchSolution(gameType, level, startDeadline(0))
    expect(result.timedOut).toBe(true)
    expect(result.solvable).toBe(false)
  })
})
