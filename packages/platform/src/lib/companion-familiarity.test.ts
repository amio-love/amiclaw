/**
 * shared/companion-familiarity — the streak → relationship rules (B9 + B20).
 *
 * Covers the two pure families: the 3-tier familiarity ladder (derivation +
 * per-tier register rules) and the milestone pick (labels + the once-per-
 * milestone selection, including the 7→14 double-crossing edge).
 */
import { describe, expect, it } from 'vitest'
import {
  CLOSE_STREAK_DAYS,
  FAMILIAR_STREAK_DAYS,
  MILESTONE_STREAK_DAYS,
  deriveFamiliarityTier,
  familiarityRegisterHint,
  milestoneLabel,
  pickMilestone,
  tierUsesAddressPrefix,
} from '@shared/companion-familiarity'

describe('deriveFamiliarityTier', () => {
  it('maps streak days onto the three tiers at the pinned thresholds', () => {
    expect(deriveFamiliarityTier(0)).toBe('newcomer')
    expect(deriveFamiliarityTier(FAMILIAR_STREAK_DAYS - 1)).toBe('newcomer')
    expect(deriveFamiliarityTier(FAMILIAR_STREAK_DAYS)).toBe('familiar')
    expect(deriveFamiliarityTier(CLOSE_STREAK_DAYS - 1)).toBe('familiar')
    expect(deriveFamiliarityTier(CLOSE_STREAK_DAYS)).toBe('close')
    expect(deriveFamiliarityTier(120)).toBe('close')
  })
})

describe('tier register rules', () => {
  it('keeps the address only for the newcomer tier (fuller → closer)', () => {
    expect(tierUsesAddressPrefix('newcomer')).toBe(true)
    expect(tierUsesAddressPrefix('familiar')).toBe(false)
    expect(tierUsesAddressPrefix('close')).toBe(false)
  })

  it('injects no prompt hint for a newcomer, a warmer one for higher tiers', () => {
    expect(familiarityRegisterHint('newcomer')).toBeNull()
    expect(familiarityRegisterHint('familiar')).toContain('warmer')
    expect(familiarityRegisterHint('close')).toContain('old')
  })
})

describe('milestoneLabel', () => {
  it('names each milestone on the human time scale', () => {
    expect(milestoneLabel(7)).toBe('一周')
    expect(milestoneLabel(14)).toBe('两周')
    expect(milestoneLabel(30)).toBe('一个月')
    expect(milestoneLabel(60)).toBe('两个月')
  })
})

describe('pickMilestone', () => {
  it('returns null before the first milestone is reached', () => {
    expect(pickMilestone(6, [])).toBeNull()
    expect(pickMilestone(0, [])).toBeNull()
  })

  it('fires exactly the reached milestone the first time', () => {
    expect(pickMilestone(7, [])).toEqual({ fire: 7, consumed: [7] })
    expect(pickMilestone(9, [])).toEqual({ fire: 7, consumed: [7] })
    expect(pickMilestone(30, [7, 14])).toEqual({ fire: 30, consumed: [30] })
  })

  it('never repeats an already-fired milestone', () => {
    expect(pickMilestone(7, [7])).toBeNull()
    expect(pickMilestone(13, [7])).toBeNull()
    expect(pickMilestone(60, [7, 14, 30, 60])).toBeNull()
  })

  it('fires ONE beat and silently consumes the lower on a 7→14 double-crossing', () => {
    // A player who returns already past two thresholds sees the HIGHER beat once;
    // the 7-day beat is retired without firing (you never go back to a week in).
    expect(pickMilestone(15, [])).toEqual({ fire: 14, consumed: [7, 14] })
    // Three at once (fresh device already deep into a streak): highest only.
    expect(pickMilestone(31, [])).toEqual({ fire: 30, consumed: [7, 14, 30] })
    // Mixed: 7 already fired, 14 + 30 newly crossed → 30 fires, 14 retired.
    expect(pickMilestone(30, [7])).toEqual({ fire: 30, consumed: [14, 30] })
  })

  it('fires each declared threshold in turn once the lower ones are consumed', () => {
    const consumed: number[] = []
    for (const day of MILESTONE_STREAK_DAYS) {
      expect(pickMilestone(day, consumed)).toEqual({ fire: day, consumed: [day] })
      consumed.push(day)
    }
  })
})
