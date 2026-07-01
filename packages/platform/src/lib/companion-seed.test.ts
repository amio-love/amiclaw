/**
 * companion-seed host-gate tests.
 *
 * The dev seed may activate ONLY on local dev or a Cloudflare Pages preview
 * subdomain (`*.amiclaw.pages.dev`). On the production hosts — the custom
 * domain `claw.amio.fans` and the bare production `amiclaw.pages.dev` — it must
 * be inert: `?companionSeed=1` neither activates nor persists, so it can never
 * bypass the companion login gate or fake destructive actions in production.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { companionSeedEnabled } from './companion-seed'

const originalLocation = window.location

function setLocation(hostname: string, search = '') {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { hostname, search },
  })
}

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
  window.sessionStorage.clear()
})

describe('companionSeedEnabled host gate', () => {
  it('activates on localhost and 127.0.0.1 with ?companionSeed=1', () => {
    setLocation('localhost', '?companionSeed=1')
    expect(companionSeedEnabled()).toBe(true)

    window.sessionStorage.clear()
    setLocation('127.0.0.1', '?companionSeed=1')
    expect(companionSeedEnabled()).toBe(true)
  })

  it('activates on a *.amiclaw.pages.dev preview subdomain and persists the flag', () => {
    setLocation('23eedcb4.amiclaw.pages.dev', '?companionSeed=1')
    expect(companionSeedEnabled()).toBe(true)

    // The persisted flag keeps it active across in-session navigation (no param).
    setLocation('23eedcb4.amiclaw.pages.dev', '')
    expect(companionSeedEnabled()).toBe(true)
  })

  it('is inert on the custom production domain claw.amio.fans', () => {
    setLocation('claw.amio.fans', '?companionSeed=1')
    expect(companionSeedEnabled()).toBe(false)
    // Nothing was persisted — moving to an allowed host without the param stays off.
    setLocation('localhost', '')
    expect(companionSeedEnabled()).toBe(false)
  })

  it('is inert on the bare production amiclaw.pages.dev (not a *.amiclaw.pages.dev subdomain)', () => {
    setLocation('amiclaw.pages.dev', '?companionSeed=1')
    expect(companionSeedEnabled()).toBe(false)
  })

  it('honors ?companionSeed=0 to clear the flag on an allowed host', () => {
    setLocation('preview.amiclaw.pages.dev', '?companionSeed=1')
    expect(companionSeedEnabled()).toBe(true)
    setLocation('preview.amiclaw.pages.dev', '?companionSeed=0')
    expect(companionSeedEnabled()).toBe(false)
    setLocation('preview.amiclaw.pages.dev', '')
    expect(companionSeedEnabled()).toBe(false)
  })
})
