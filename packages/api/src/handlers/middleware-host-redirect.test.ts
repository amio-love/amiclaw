import { describe, it, expect } from 'vitest'
import {
  LEGACY_HOST,
  ORACLE_HOST,
  CANONICAL_HOST,
  mapLegacyBombsquadPath,
  mapLegacyOraclePath,
} from './middleware-host-redirect'

/**
 * Covers the path-mapping table the `bombsquad.amio.fans` → `claw.amio.fans`
 * 301 middleware (`functions/_middleware.ts`) is built on. The mapper is a
 * pure function over (pathname, search); the middleware itself just wires
 * it to `Response.redirect(..., 301)` when the inbound Host matches
 * `LEGACY_HOST`. Keeping the mapping rules pure lets us assert them
 * exhaustively without spinning up a Workers runtime.
 */
describe('mapLegacyBombsquadPath — specific path rewrites', () => {
  it('rewrites the legacy SPA routes onto the /bombsquad prefix', () => {
    const cases: [string, string][] = [
      ['/', `https://${CANONICAL_HOST}/bombsquad`],
      ['/game', `https://${CANONICAL_HOST}/bombsquad`],
      ['/game/connect', `https://${CANONICAL_HOST}/bombsquad/connect`],
      ['/game/run', `https://${CANONICAL_HOST}/bombsquad/run`],
      ['/result', `https://${CANONICAL_HOST}/bombsquad/result`],
      ['/compatibility', `https://${CANONICAL_HOST}/bombsquad/compatibility`],
    ]
    for (const [pathname, expected] of cases) {
      expect(mapLegacyBombsquadPath(pathname, '')).toBe(expected)
    }
  })

  it('preserves the query string when rewriting SPA routes', () => {
    expect(mapLegacyBombsquadPath('/game', '?mode=daily')).toBe(
      `https://${CANONICAL_HOST}/bombsquad?mode=daily`
    )
    expect(mapLegacyBombsquadPath('/game/run', '?mode=daily&url=foo%20bar')).toBe(
      `https://${CANONICAL_HOST}/bombsquad/run?mode=daily&url=foo%20bar`
    )
    expect(mapLegacyBombsquadPath('/result', '?source=email')).toBe(
      `https://${CANONICAL_HOST}/bombsquad/result?source=email`
    )
  })

  it('passes through /manual/* and /api/* paths verbatim onto the canonical host', () => {
    expect(mapLegacyBombsquadPath('/manual/2026-05-22', '')).toBe(
      `https://${CANONICAL_HOST}/manual/2026-05-22`
    )
    expect(mapLegacyBombsquadPath('/manual/practice', '?format=yaml')).toBe(
      `https://${CANONICAL_HOST}/manual/practice?format=yaml`
    )
    expect(mapLegacyBombsquadPath('/api/leaderboard', '?date=2026-05-22')).toBe(
      `https://${CANONICAL_HOST}/api/leaderboard?date=2026-05-22`
    )
    expect(mapLegacyBombsquadPath('/api/events', '')).toBe(`https://${CANONICAL_HOST}/api/events`)
    expect(mapLegacyBombsquadPath('/api/dashboard', '?token=abc')).toBe(
      `https://${CANONICAL_HOST}/api/dashboard?token=abc`
    )
  })

  it('passes through unknown paths verbatim — no surprise rewrite', () => {
    expect(mapLegacyBombsquadPath('/leaderboard', '')).toBe(`https://${CANONICAL_HOST}/leaderboard`)
    expect(mapLegacyBombsquadPath('/community', '')).toBe(`https://${CANONICAL_HOST}/community`)
    expect(mapLegacyBombsquadPath('/some/future/page', '?x=1')).toBe(
      `https://${CANONICAL_HOST}/some/future/page?x=1`
    )
  })

  it('treats an empty pathname like root (defensive — `URL` always produces "/")', () => {
    expect(mapLegacyBombsquadPath('', '')).toBe(`https://${CANONICAL_HOST}/bombsquad`)
  })
})

/**
 * Covers the path-mapping table the `oracle.amio.fans` → `claw.amio.fans`
 * 301 middleware is built on. Unlike BombSquad, the Yijing Oracle SPA lives
 * entirely under `/oracle/*`, so unknown paths are prefixed with `/oracle`
 * rather than passed through verbatim; the shared `/manual/*` and `/api/*`
 * namespaces still pass through unchanged.
 */
describe('mapLegacyOraclePath — Oracle SPA path rewrites', () => {
  it('maps root to the /oracle landing on the canonical host', () => {
    expect(mapLegacyOraclePath('/', '')).toBe(`https://${CANONICAL_HOST}/oracle`)
  })

  it('treats an empty pathname like root (defensive — `URL` always produces "/")', () => {
    expect(mapLegacyOraclePath('', '')).toBe(`https://${CANONICAL_HOST}/oracle`)
  })

  it('passes through /manual/* paths verbatim onto the canonical host', () => {
    expect(mapLegacyOraclePath('/manual/2026-05-30', '')).toBe(
      `https://${CANONICAL_HOST}/manual/2026-05-30`
    )
  })

  it('passes through /api/* paths verbatim, preserving the query string', () => {
    expect(mapLegacyOraclePath('/api/leaderboard', '?date=2026-05-30')).toBe(
      `https://${CANONICAL_HOST}/api/leaderboard?date=2026-05-30`
    )
  })

  it('prefixes unknown SPA paths with /oracle', () => {
    expect(mapLegacyOraclePath('/casting', '')).toBe(`https://${CANONICAL_HOST}/oracle/casting`)
  })

  it('prefixes deep SPA paths with /oracle and preserves the query string', () => {
    expect(mapLegacyOraclePath('/reading/sign', '?seed=42')).toBe(
      `https://${CANONICAL_HOST}/oracle/reading/sign?seed=42`
    )
  })
})

describe('LEGACY_HOST / ORACLE_HOST / CANONICAL_HOST constants', () => {
  it('exposes the exact host strings the middleware checks against', () => {
    // These strings are the authoritative spelling. If a rename ever lands,
    // the test must change in lockstep — a typo here would silently break
    // every legacy link in the wild.
    expect(LEGACY_HOST).toBe('bombsquad.amio.fans')
    expect(ORACLE_HOST).toBe('oracle.amio.fans')
    expect(CANONICAL_HOST).toBe('claw.amio.fans')
  })
})
