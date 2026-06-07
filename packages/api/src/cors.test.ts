import { describe, expect, it } from 'vitest'
import { buildCorsHeaders, resolveCorsOrigin } from './cors'
import { onRequest as leaderboardOnRequest } from '../../../functions/api/leaderboard'

const CANONICAL_ORIGIN = 'https://claw.amio.fans'

// Build a request carrying a given `Origin` header. A `null` origin omits the
// header entirely (the missing-Origin case).
function requestWithOrigin(origin: string | null): Request {
  return new Request('https://claw.amio.fans/api/leaderboard', {
    headers: origin === null ? {} : { Origin: origin },
  })
}

describe('resolveCorsOrigin — allowlist echo / fallback', () => {
  it('echoes the production canonical origin', () => {
    expect(resolveCorsOrigin(requestWithOrigin('https://claw.amio.fans'))).toBe(
      'https://claw.amio.fans'
    )
  })

  it('echoes a preview deployment origin on *.amiclaw.pages.dev', () => {
    expect(resolveCorsOrigin(requestWithOrigin('https://pr-42.amiclaw.pages.dev'))).toBe(
      'https://pr-42.amiclaw.pages.dev'
    )
  })

  it('falls back to canonical for an unknown origin', () => {
    expect(resolveCorsOrigin(requestWithOrigin('https://evil.example.com'))).toBe(CANONICAL_ORIGIN)
  })

  it('falls back to canonical when the Origin header is absent', () => {
    expect(resolveCorsOrigin(requestWithOrigin(null))).toBe(CANONICAL_ORIGIN)
  })
})

describe('resolveCorsOrigin — subdomain-spoof rejection', () => {
  // A bare-string `endsWith('.amiclaw.pages.dev')` on the whole Origin would be
  // fooled by some of these; structured hostname + protocol matching is not.
  const spoofs = [
    ['no dot before the suffix', 'https://evil-amiclaw.pages.dev'],
    ['suffix not at the end', 'https://x.amiclaw.pages.dev.attacker.com'],
    ['preview host over http, not https', 'http://x.amiclaw.pages.dev'],
    ['bare apex is not a subdomain', 'https://amiclaw.pages.dev'],
    ['malformed origin', 'not-a-url'],
    // Credential-injection: the `user@host` form puts the preview suffix in the
    // userinfo, so `new URL(...).hostname` is the real authority `evil.com`.
    ['credentials before an attacker host', 'https://x.amiclaw.pages.dev@evil.com'],
    // Trailing-dot FQDN: `new URL` keeps the dot, so the hostname is
    // `x.amiclaw.pages.dev.` which does NOT `endsWith('.amiclaw.pages.dev')`.
    ['trailing-dot FQDN', 'https://x.amiclaw.pages.dev.'],
    // The literal string "null" is not a parseable absolute URL — `new URL`
    // throws and the catch treats it as not allowed. Distinct from the
    // missing-Origin case (no header) covered above.
    ['literal null-string origin', 'null'],
    // Non-https scheme is rejected by the explicit protocol guard.
    ['file scheme', 'file:///etc/passwd'],
  ] as const

  for (const [label, origin] of spoofs) {
    it(`falls back to canonical — ${label} (${origin})`, () => {
      expect(resolveCorsOrigin(requestWithOrigin(origin))).toBe(CANONICAL_ORIGIN)
    })
  }
})

describe('resolveCorsOrigin — allowed-host normalization echoes the raw Origin', () => {
  // These two ARE allowed: the URL API normalizes the hostname (lowercasing the
  // host, stripping the port from `hostname`) so a real preview subdomain still
  // matches the suffix. The allow path echoes the request's raw Origin string
  // verbatim — including the original casing / port — which is what the browser
  // compares its own Origin against. Not a spoof: both resolve to a genuine
  // `*.amiclaw.pages.dev` authority.
  const echoes = [
    ['uppercase host (URL API lowercases hostname)', 'https://X.AMICLAW.PAGES.DEV'],
    ['explicit port (hostname excludes the port)', 'https://x.amiclaw.pages.dev:8080'],
  ] as const

  for (const [label, origin] of echoes) {
    it(`echoes the raw Origin — ${label} (${origin})`, () => {
      expect(resolveCorsOrigin(requestWithOrigin(origin))).toBe(origin)
    })
  }
})

describe('buildCorsHeaders — header shape', () => {
  it('passes the entry-specific methods string through verbatim', () => {
    const headers = buildCorsHeaders(
      requestWithOrigin('https://claw.amio.fans'),
      'GET, POST, OPTIONS'
    )
    expect(headers['Access-Control-Allow-Methods']).toBe('GET, POST, OPTIONS')
    expect(headers['Access-Control-Allow-Headers']).toBe('Content-Type')
  })

  it('always sets Vary: Origin so caches do not cross-serve origins', () => {
    const headers = buildCorsHeaders(
      requestWithOrigin('https://pr-1.amiclaw.pages.dev'),
      'POST, OPTIONS'
    )
    expect(headers.Vary).toBe('Origin')
  })

  it('reflects the resolved allow-origin in the header', () => {
    const allowed = buildCorsHeaders(
      requestWithOrigin('https://pr-7.amiclaw.pages.dev'),
      'GET, OPTIONS'
    )
    expect(allowed['Access-Control-Allow-Origin']).toBe('https://pr-7.amiclaw.pages.dev')

    const denied = buildCorsHeaders(requestWithOrigin('https://evil.example.com'), 'GET, OPTIONS')
    expect(denied['Access-Control-Allow-Origin']).toBe(CANONICAL_ORIGIN)
  })
})

describe('leaderboard entry — OPTIONS preflight', () => {
  // The thin entry is the real consumer of buildCorsHeaders. A preflight must
  // answer 204 with the entry's method set and the resolved (echoed) origin.
  it('returns 204 with Access-Control-Allow-Methods and the echoed preview origin', async () => {
    const request = new Request('https://claw.amio.fans/api/leaderboard', {
      method: 'OPTIONS',
      headers: { Origin: 'https://pr-42.amiclaw.pages.dev' },
    })
    const res = await leaderboardOnRequest({
      request,
      env: { LEADERBOARD: {} as unknown as KVNamespace },
    })

    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, OPTIONS')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://pr-42.amiclaw.pages.dev')
    expect(res.headers.get('Vary')).toBe('Origin')
  })
})
