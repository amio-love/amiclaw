/**
 * bg-standard-001 engine play. The mis-care dangers are all triggered by REAL
 * shipped verbs (water / shade / …) — never an injected exotic action_type —
 * because the only player-reachable health-decline is via mis-shading that
 * REMOVES a heal (decay then kills): `change_health` has no state_effect and
 * `state_effect` only advances toward the best state, so no verb declines
 * health directly (see r5-fix1 report for the engine boundary). Also covers
 * the moss+succulent synergy heal, the load-bearing light skill, the intended
 * winning playthrough, and the synergy edit staying inert on the tutorial.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadGameType, loadLevel } from '../schema/load'
import { GameSession } from './engine'

const bgDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'fixtures',
  'botanical-garden'
)
const gameType = loadGameType(readFileSync(join(bgDir, 'game-type.yaml'), 'utf8'))
const standard = loadLevel(readFileSync(join(bgDir, 'level.bg-standard-001.yaml'), 'utf8'))
const tutorial = loadLevel(readFileSync(join(bgDir, 'level.bg-demo-001.yaml'), 'utf8'))

const care = (session: GameSession, elementId: string, actionType: string) =>
  session.performAction('gardener', 'apply_care', {
    element_id: elementId,
    action_type: actionType,
  })
const health = (session: GameSession, elementId: string) =>
  session.getState().elements[elementId].health
const light = (session: GameSession, elementId: string) =>
  session.getState().elements[elementId].effective_light

describe('bg-standard-001 — reachable mis-care dangers (real verbs only)', () => {
  it('orchid must-shade: caring at full_sun is wasted; shade heals it', () => {
    const session = new GameSession(gameType, standard)
    expect(health(session, 'plant-orchid')).toBe('wilting')
    expect(light(session, 'plant-orchid')).toBe('full_sun')

    // Watering the orchid at full_sun does nothing — rule-orchid-care needs
    // partial_shade, and rule-health-shaded has no correct_care row.
    care(session, 'plant-orchid', 'water')
    expect(health(session, 'plant-orchid')).toBe('wilting')

    // Shade once → partial_shade → rule-orchid-care heals wilting → stable.
    care(session, 'plant-orchid', 'shade')
    expect(light(session, 'plant-orchid')).toBe('partial_shade')
    expect(health(session, 'plant-orchid')).toBe('stable')
  })

  it('orchid over-shade lockout: shading twice drops it to full_shade where it can never heal', () => {
    const session = new GameSession(gameType, standard)
    care(session, 'plant-orchid', 'shade') // full_sun → partial_shade (heals wilting → stable)
    care(session, 'plant-orchid', 'shade') // partial_shade → full_shade (irreversible)
    expect(light(session, 'plant-orchid')).toBe('full_shade')
    expect(health(session, 'plant-orchid')).toBe('stable')

    // At full_shade, further care no longer heals — the heal is locked out (at
    // partial_shade this same care would advance stable → thriving).
    care(session, 'plant-orchid', 'fertilize')
    expect(health(session, 'plant-orchid')).toBe('stable')
  })

  it('fern mis-shade: shading the fern (already in the right light) locks out its heal', () => {
    const session = new GameSession(gameType, standard)
    expect(light(session, 'plant-fern')).toBe('partial_shade')

    // Control: at its starting partial_shade, caring heals the fern.
    const control = new GameSession(gameType, standard)
    care(control, 'plant-fern', 'water')
    expect(health(control, 'plant-fern')).toBe('stable')

    // Trap: shading the fern drops it to full_shade — no heal, and now locked.
    care(session, 'plant-fern', 'shade')
    expect(light(session, 'plant-fern')).toBe('full_shade')
    expect(health(session, 'plant-fern')).toBe('wilting')
    care(session, 'plant-fern', 'water')
    expect(health(session, 'plant-fern')).toBe('wilting') // locked out of healing
  })
})

describe('bg-standard-001 — synergy heal bonus (matrix affects play)', () => {
  it('caring for one synergy plant heals its untouched partner', () => {
    const session = new GameSession(gameType, standard)
    expect(health(session, 'plant-moss')).toBe('stable')
    expect(health(session, 'plant-succulent')).toBe('stable')

    // Watering moss: correct_care lifts moss stable → thriving, and the
    // moss+succulent synergy lifts the untouched succulent stable → thriving.
    care(session, 'plant-moss', 'water')
    expect(health(session, 'plant-moss')).toBe('thriving')
    expect(health(session, 'plant-succulent')).toBe('thriving')
  })
})

describe('bg-standard-001 — intended playthrough wins', () => {
  it('shade the orchid, tend the fern, water moss (synergy), grow the orchid to flowering', () => {
    const session = new GameSession(gameType, standard)
    expect(session.isWon()).toBe(false)

    care(session, 'plant-orchid', 'shade') // orchid heals wilting → stable
    expect(health(session, 'plant-orchid')).toBe('stable')
    care(session, 'plant-fern', 'water') // fern-care heals wilting → stable
    expect(health(session, 'plant-fern')).toBe('stable')
    care(session, 'plant-moss', 'water') // moss → thriving, succulent → thriving (synergy)
    care(session, 'plant-orchid', 'fertilize') // seedling → juvenile (also heals at partial_shade)
    care(session, 'plant-orchid', 'repot') // juvenile → mature
    care(session, 'plant-orchid', 'bloom') // mature → flowering
    expect(session.getState().elements['plant-orchid'].growth_stage).toBe('flowering')

    expect(session.isWon()).toBe(true)
    expect(session.getState().won).toBe(true)
  })
})

describe('the synergy effect_schema edit is inert on the tutorial (bg-demo-001)', () => {
  it('watering the tutorial fern heals only the correct_care step (no synergy pair)', () => {
    const session = new GameSession(gameType, tutorial)
    expect(health(session, 'plant-1')).toBe('wilting')
    care(session, 'plant-1', 'water')
    // Only correct_care fires: wilting → stable. NOT thriving — bg-demo-001 has
    // no moss, so the [fern, moss, synergy] row never matches a real pair.
    expect(health(session, 'plant-1')).toBe('stable')
  })

  it('the scripted tutorial care loop still wins', () => {
    const session = new GameSession(gameType, tutorial)
    care(session, 'plant-1', 'water')
    care(session, 'plant-3', 'shade')
    care(session, 'plant-3', 'fertilize')
    care(session, 'plant-3', 'repot')
    care(session, 'plant-3', 'bloom')
    expect(session.isWon()).toBe(true)
  })
})
