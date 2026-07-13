import { describe, expect, it } from 'vitest'
import type { CompanionContext, CompanionContextEpisode } from '../../companion-memory/src/types'
import {
  filterPublicGenerationContext,
  MAX_EPISODE_CONTEXT_CODEPOINTS,
  MAX_PUBLIC_PROXY_EPISODES,
} from './proxy-social-filter'

function episode(overrides: Partial<CompanionContextEpisode> = {}): CompanionContextEpisode {
  return {
    title: 'A clean defuse',
    narrative: 'We cut the last wire together.',
    occurred_at: '2026-07-01T00:00:00.000Z',
    game_id: 'bombsquad',
    source_kind: 'settlement',
    salience: 50,
    ...overrides,
  }
}

function contextWith(episodes: CompanionContextEpisode[]): CompanionContext {
  return {
    companion: { name: 'Nova', address_style: 'friend', voice_id: 'companion-warm' },
    claims: [{ dimension: 'style', claim: 'prefers direct plans' }],
    episodes,
    familiarity: { streakDays: 30, tier: 'familiar' },
  }
}

describe('filterPublicGenerationContext — auditable privacy boundary', () => {
  it('drops claims + familiarity structurally and keeps only public companion identity', () => {
    const result = filterPublicGenerationContext(contextWith([episode()]))

    // Structural exclusion — the output has no home for these keys.
    expect('claims' in result).toBe(false)
    expect('familiarity' in result).toBe(false)
    expect(result.companion).toEqual({ name: 'Nova', address_style: 'friend' })
    expect('voice_id' in result.companion).toBe(false)

    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('prefers direct plans')
    expect(serialized).not.toContain('familiarity')
    expect(serialized).not.toContain('voice_id')
  })

  it('keeps only allowlisted game source_kinds; drops non-allowlist and missing kinds', () => {
    const result = filterPublicGenerationContext(
      contextWith([
        episode({ title: 'settlement one', source_kind: 'settlement' }),
        episode({ title: 'summary one', source_kind: 'session_summary' }),
        // A future non-game kind — cast because the union does not name it yet;
        // the allowlist must exclude it by default.
        episode({
          title: 'private note',
          source_kind: 'private_note' as CompanionContextEpisode['source_kind'],
        }),
        episode({ title: 'no kind', source_kind: undefined }),
      ])
    )

    const titles = result.episodes.map((e) => e.title)
    expect(titles).toContain('settlement one')
    expect(titles).toContain('summary one')
    expect(titles).not.toContain('private note')
    expect(titles).not.toContain('no kind')
  })

  it('ranks episodes by salience desc and hard-caps to MAX_PUBLIC_PROXY_EPISODES', () => {
    const many = Array.from({ length: MAX_PUBLIC_PROXY_EPISODES + 3 }, (_, i) =>
      episode({ title: `ep-${i}`, salience: i * 10 })
    )
    const result = filterPublicGenerationContext(contextWith(many))

    expect(result.episodes).toHaveLength(MAX_PUBLIC_PROXY_EPISODES)
    const expected = [...many]
      .sort((a, b) => (b.salience ?? 0) - (a.salience ?? 0))
      .slice(0, MAX_PUBLIC_PROXY_EPISODES)
      .map((e) => e.title)
    expect(result.episodes.map((e) => e.title)).toEqual(expected)
  })

  it('truncates each narrative to MAX_EPISODE_CONTEXT_CODEPOINTS (codepoint-aware)', () => {
    const long = '🎮'.repeat(MAX_EPISODE_CONTEXT_CODEPOINTS + 50)
    const truncated = filterPublicGenerationContext(contextWith([episode({ narrative: long })]))
    expect([...truncated.episodes[0].narrative]).toHaveLength(MAX_EPISODE_CONTEXT_CODEPOINTS)

    const short = filterPublicGenerationContext(contextWith([episode({ narrative: 'short' })]))
    expect(short.episodes[0].narrative).toBe('short')
  })

  it('does not mutate the input context', () => {
    const input = contextWith([episode({ salience: 10 }), episode({ salience: 90 })])
    const before = JSON.stringify(input)
    filterPublicGenerationContext(input)
    expect(JSON.stringify(input)).toBe(before)
  })
})
