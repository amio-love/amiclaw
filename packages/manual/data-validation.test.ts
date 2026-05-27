import { describe, expect, it, beforeAll } from 'vitest'
import { collectReferencedSymbols, validateManualSymbols, type Manual } from '@shared/manual-schema'
import { SYMBOLS } from '@shared/symbols'
import yaml from 'js-yaml'
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'fs'
import { resolve, join } from 'path'
import { execFileSync } from 'child_process'
import { validateNoSourceAiInstructions, validateNoSourceSymbols } from './validators'

const PRACTICE_YAML = resolve(__dirname, 'data/practice.yaml')
const DAILY_DIR = resolve(__dirname, 'data/daily')
const MANUAL_DIST = resolve(__dirname, 'dist')

function buildManualForTests(): void {
  execFileSync('pnpm', ['--filter', 'manual', 'build'], {
    cwd: resolve(__dirname, '../..'),
    stdio: 'pipe',
  })
}

describe('shipped manual YAMLs', () => {
  function loadYaml(path: string): Manual {
    return yaml.load(readFileSync(path, 'utf8')) as Manual
  }

  it('practice.yaml loads and references only registered symbols', () => {
    const manual = loadYaml(PRACTICE_YAML)
    expect(() => validateManualSymbols(manual, SYMBOLS)).not.toThrow()
  })

  it('every daily YAML loads and references only registered symbols', () => {
    const dailyFiles = readdirSync(DAILY_DIR).filter((f) => f.endsWith('.yaml'))
    expect(dailyFiles.length).toBeGreaterThan(0)
    for (const file of dailyFiles) {
      const manual = loadYaml(join(DAILY_DIR, file))
      expect(
        () => validateManualSymbols(manual, SYMBOLS),
        `${file} validation failed`
      ).not.toThrow()
    }
  })

  it('every registered SYMBOLS description is non-trivially long (basic sanity)', () => {
    for (const sym of SYMBOLS) {
      expect(sym.description.length, `symbol ${sym.id} description too short`).toBeGreaterThan(4)
    }
  })
})

describe('source YAMLs and dist raw YAMLs ship no symbols block (Option C invariant)', () => {
  beforeAll(() => {
    buildManualForTests()
  })

  it('practice.yaml source has no top-level symbols block', () => {
    const parsed = yaml.load(readFileSync(PRACTICE_YAML, 'utf8')) as Record<string, unknown>
    expect(parsed.symbols).toBeUndefined()
  })

  it('practice.yaml dist raw has no top-level symbols block', () => {
    const parsed = yaml.load(
      readFileSync(join(MANUAL_DIST, 'data/practice.yaml'), 'utf8')
    ) as Record<string, unknown>
    expect(parsed.symbols).toBeUndefined()
  })

  it('every daily YAML source/dist raw has no top-level symbols block', () => {
    const dailyFiles = readdirSync(DAILY_DIR).filter((f) => f.endsWith('.yaml'))
    expect(dailyFiles.length).toBeGreaterThan(0)
    for (const file of dailyFiles) {
      const sourceParsed = yaml.load(readFileSync(join(DAILY_DIR, file), 'utf8')) as Record<
        string,
        unknown
      >
      expect(sourceParsed.symbols, `source ${file} should not ship a symbols block`).toBeUndefined()

      const distRawParsed = yaml.load(
        readFileSync(join(MANUAL_DIST, 'data', file), 'utf8')
      ) as Record<string, unknown>
      expect(
        distRawParsed.symbols,
        `dist raw ${file} should not ship a symbols block`
      ).toBeUndefined()
    }
  })
})

describe('manual HTML embedded yaml descriptions match shared/symbols.ts SSOT', () => {
  beforeAll(() => {
    buildManualForTests()
  })

  const SSOT_DESCRIPTIONS: Map<string, string> = new Map(SYMBOLS.map((s) => [s.id, s.description]))

  function extractEmbeddedYaml(htmlPath: string): Manual {
    const html = readFileSync(htmlPath, 'utf8')
    const m = html.match(/<pre class="anti-human">([\s\S]*?)<\/pre>/)
    if (!m) throw new Error(`No <pre class="anti-human"> block found in ${htmlPath}`)
    return yaml.load(m[1]) as Manual
  }

  function diffEmbeddedAgainstSSOT(label: string, manual: Manual): string[] {
    const errors: string[] = []
    const referenced = collectReferencedSymbols(manual.modules)
    const embedded = manual.symbols ?? {}
    for (const id of referenced) {
      const ssotDesc = SSOT_DESCRIPTIONS.get(id)
      if (ssotDesc === undefined) {
        errors.push(
          `${label}: symbol id '${id}' referenced in modules but NOT registered in shared/symbols.ts SYMBOLS.`
        )
        continue
      }
      const entry = embedded[id]
      if (!entry) {
        errors.push(
          `${label}: symbol '${id}' referenced in modules but missing from HTML-embedded yaml symbols block (build did not inject).`
        )
        continue
      }
      if (entry.description !== ssotDesc) {
        errors.push(
          `${label}: symbol '${id}' description differs from shared/symbols.ts SSOT (character-level mismatch).\n` +
            `  embedded: ${JSON.stringify(entry.description)}\n` +
            `  SYMBOLS:  ${JSON.stringify(ssotDesc)}`
        )
      }
    }
    return errors
  }

  it('practice manual HTML symbol descriptions character-equal to SYMBOLS', () => {
    const manual = extractEmbeddedYaml(join(MANUAL_DIST, 'practice/index.html'))
    const errors = diffEmbeddedAgainstSSOT('practice/index.html', manual)
    expect(errors, `\n${errors.join('\n')}`).toEqual([])
  })

  it('every daily manual HTML symbol descriptions character-equal to SYMBOLS', () => {
    const dailyFiles = readdirSync(DAILY_DIR).filter((f) => f.endsWith('.yaml'))
    expect(dailyFiles.length).toBeGreaterThan(0)
    const errors: string[] = []
    for (const file of dailyFiles) {
      const slug = file.replace(/\.yaml$/, '')
      const manual = extractEmbeddedYaml(join(MANUAL_DIST, slug, 'index.html'))
      errors.push(...diffEmbeddedAgainstSSOT(`${slug}/index.html`, manual))
    }
    expect(errors, `\n${errors.join('\n')}`).toEqual([])
  })
})

describe('manual-referenced symbols have Chinese descriptions', () => {
  // Every symbol id actually referenced by any shipped manual (practice + all
  // daily) must carry at least one CJK Unified Ideograph in its SYMBOLS
  // description. The AI partner reads the description to map an abstract
  // symbol id to a shape vocabulary the player can verbally recognize — an
  // English-only placeholder description (e.g. "eye shape with a dot in the
  // center") is unreadable to a Chinese-speaking voice channel and silently
  // breaks the keypad / symbol_dial loop.
  //
  // Currently-unreferenced symbols (eye / lambda / arrow-loop / target /
  // zigzag) are still allowed to carry English-only descriptions — this guard
  // only enforces the rule on ids the manual actually injects. It catches the
  // drift where someone later adds an English-described symbol to a
  // keypad.sequences or symbol_dial.columns row without translating it first.
  const CJK_REGEX = /[一-鿿]/
  const SYMBOL_BY_ID = new Map(SYMBOLS.map((s) => [s.id, s]))

  function loadManual(path: string): Manual {
    return yaml.load(readFileSync(path, 'utf8')) as Manual
  }

  function collectAllReferencedIds(): Set<string> {
    const ids = new Set<string>()
    const add = (m: Manual): void => {
      for (const id of collectReferencedSymbols(m.modules)) ids.add(id)
    }
    add(loadManual(PRACTICE_YAML))
    const dailyFiles = readdirSync(DAILY_DIR).filter((f) => f.endsWith('.yaml'))
    expect(dailyFiles.length).toBeGreaterThan(0)
    for (const file of dailyFiles) {
      add(loadManual(join(DAILY_DIR, file)))
    }
    return ids
  }

  it('every manual-referenced symbol description contains at least one Chinese character', () => {
    const referenced = collectAllReferencedIds()
    const offenders: string[] = []
    for (const id of referenced) {
      const sym = SYMBOL_BY_ID.get(id)
      // Missing-from-registry case is already covered by validateManualSymbols
      // in the suite above — skip here to keep the failure message focused on
      // the description-language assertion.
      if (!sym) continue
      if (!CJK_REGEX.test(sym.description)) {
        offenders.push(`${id}: ${JSON.stringify(sym.description)}`)
      }
    }
    expect(
      offenders,
      `Symbols referenced by a shipped manual but described in English-only:\n  ${offenders.join('\n  ')}`
    ).toEqual([])
  })
})

describe('manual set-discrimination invariant', () => {
  // A keypad sequence is solvable from the manual only if any player-visible
  // 4-symbol subset attributes to exactly one sequence. That holds iff any two
  // sequences share at most 3 symbols — a shared 4-symbol subset would force a
  // pairwise intersection of >=4. Likewise dial columns must pairwise share at
  // most 2 symbols so any 3-symbol subset attributes to exactly one column.
  // The pairwise-intersection bound IS the subset-uniqueness proof, so this
  // check over practice.yaml + every daily file is the exhaustive guard for
  // Acceptance Scenario 1 of fix-keypad-manual-sequence-ambiguity.
  function loadManual(path: string): Manual {
    return yaml.load(readFileSync(path, 'utf8')) as Manual
  }

  function maxPairwiseIntersection(rows: string[][]): number {
    let max = 0
    for (let i = 0; i < rows.length; i++) {
      const a = new Set(rows[i])
      for (let j = i + 1; j < rows.length; j++) {
        const shared = rows[j].reduce((n, s) => n + (a.has(s) ? 1 : 0), 0)
        if (shared > max) max = shared
      }
    }
    return max
  }

  function assertDiscriminating(label: string, manual: Manual): void {
    expect(
      maxPairwiseIntersection(manual.modules.keypad.sequences),
      `${label}: two keypad sequences share >3 symbols — a 4-symbol subset would be ambiguous`
    ).toBeLessThanOrEqual(3)
    expect(
      maxPairwiseIntersection(manual.modules.symbol_dial.columns),
      `${label}: two dial columns share >2 symbols — a 3-symbol subset would be ambiguous`
    ).toBeLessThanOrEqual(2)
  }

  it('practice.yaml keypad sequences and dial columns are set-discriminating', () => {
    assertDiscriminating('practice.yaml', loadManual(PRACTICE_YAML))
  })

  it('every daily YAML keypad sequences and dial columns are set-discriminating', () => {
    const dailyFiles = readdirSync(DAILY_DIR).filter((f) => f.endsWith('.yaml'))
    expect(dailyFiles.length).toBeGreaterThan(0)
    for (const file of dailyFiles) {
      assertDiscriminating(file, loadManual(join(DAILY_DIR, file)))
    }
  })
})

describe('AI_INSTRUCTIONS carries game framing + collaboration philosophy', () => {
  // build.ts injects AI_INSTRUCTIONS into the HTML-embedded yaml AND the dist
  // raw yaml on every render. This block locks in the four-key schema (the
  // existing tactical-output keys plus the new framing + philosophy keys) so
  // the AI receives full game context before any rule content, on every
  // manual fetch, in either consumption path.
  beforeAll(() => {
    buildManualForTests()
  })

  interface ManualWithInstructions extends Manual {
    ai_instructions?: Record<string, string[]>
  }

  function extractEmbeddedYaml(htmlPath: string): ManualWithInstructions {
    const html = readFileSync(htmlPath, 'utf8')
    const m = html.match(/<pre class="anti-human">([\s\S]*?)<\/pre>/)
    if (!m) throw new Error(`No <pre class="anti-human"> block found in ${htmlPath}`)
    return yaml.load(m[1]) as ManualWithInstructions
  }

  const REQUIRED_KEYS = [
    'do_not_reveal_to_player',
    'give_conclusions_not_reasoning',
    'game_context',
    'collaboration_philosophy',
  ] as const

  it('practice manual HTML embedded yaml ai_instructions contains all four required keys', () => {
    const manual = extractEmbeddedYaml(join(MANUAL_DIST, 'practice/index.html'))
    expect(
      manual.ai_instructions,
      'ai_instructions block missing from HTML embedded yaml'
    ).toBeDefined()
    const keys = Object.keys(manual.ai_instructions ?? {})
    for (const required of REQUIRED_KEYS) {
      expect(keys, `practice HTML ai_instructions missing key '${required}'`).toContain(required)
    }
  })

  it('every ai_instructions key is a non-empty string[] with each entry at least 30 characters', () => {
    const manual = extractEmbeddedYaml(join(MANUAL_DIST, 'practice/index.html'))
    const instructions = manual.ai_instructions ?? {}
    for (const required of REQUIRED_KEYS) {
      const value = instructions[required]
      expect(Array.isArray(value), `ai_instructions['${required}'] should be a string[]`).toBe(true)
      expect(value.length, `ai_instructions['${required}'] should be non-empty`).toBeGreaterThan(0)
      for (let i = 0; i < value.length; i++) {
        const entry = value[i]
        expect(typeof entry, `ai_instructions['${required}'][${i}] should be a string`).toBe(
          'string'
        )
        expect(
          entry.length,
          `ai_instructions['${required}'][${i}] should be at least 30 characters (got ${entry.length})`
        ).toBeGreaterThanOrEqual(30)
      }
    }
  })

  it('framing and philosophy values carry the load-bearing English tokens', () => {
    const manual = extractEmbeddedYaml(join(MANUAL_DIST, 'practice/index.html'))
    const instructions = manual.ai_instructions ?? {}

    // game_context anchors session freshness (no cross-session memory) and
    // names the voice-only medium — both are physical anchors for the
    // trust-building loop and the manual's role as the only AI-facing surface.
    const gameContextText = (instructions.game_context ?? []).join('\n')
    expect(gameContextText, 'game_context must state that each fetch is a fresh game').toMatch(
      /fresh game/i
    )
    expect(gameContextText, 'game_context must name the voice-only medium').toMatch(/voice/i)

    // collaboration_philosophy must (a) tell the AI to ask the player to
    // describe shapes instead of guessing dictionary names, (b) call for
    // admitting uncertainty before guessing, and (c) anchor trust-loop data
    // source to the BombSquad app-rendered recap (NOT voice-conversation
    // replay — that would violate the zero-integration principle).
    const philosophyText = (instructions.collaboration_philosophy ?? []).join('\n')
    expect(
      philosophyText,
      'collaboration_philosophy must invite the player to describe shapes'
    ).toMatch(/describe/i)
    expect(philosophyText, 'collaboration_philosophy must call for admitting uncertainty').toMatch(
      /uncertain/i
    )
    expect(
      philosophyText,
      'collaboration_philosophy must anchor trust-loop data source to the app-rendered recap'
    ).toMatch(/recap/i)
  })
})

describe('source yaml ai_instructions block is rejected (build-time fail-loud)', () => {
  // AI_INSTRUCTIONS is owned by `build.ts` as a single hard-coded constant and
  // injected into every rendered manual. `validateNoSourceAiInstructions` is
  // the gate that rejects any source YAML that tries to carry its own
  // `ai_instructions:` block — without the gate, a malicious or careless
  // source could silently fight the hard-coded constant if the build merge
  // order ever regressed. This block locks the fail-loud contract.

  it('throws when manual carries a source-level ai_instructions block', () => {
    const fixture = {
      meta: { version: 'fixture-v1' },
      modules: {},
      ai_instructions: { decoy_key: ['decoy attempt'] },
    }
    expect(() => validateNoSourceAiInstructions(fixture)).toThrow(/ai_instructions/)
    expect(() => validateNoSourceAiInstructions(fixture)).toThrow(/source YAML/i)
  })

  it('passes silently when manual has no ai_instructions block', () => {
    const fixture = {
      meta: { version: 'fixture-v2' },
      modules: {},
    }
    expect(() => validateNoSourceAiInstructions(fixture)).not.toThrow()
  })
})

describe('manual build fails non-zero when a daily yaml is invalid (daily-loop catch is narrow)', () => {
  // End-to-end guard: the daily-build loop in `build.ts` MUST surface a
  // `buildPage` throw as a non-zero process exit. Earlier the loop was wrapped
  // in `try { readdirSync + for buildPage } catch {}` which silently swallowed
  // every error — a malformed daily yaml carrying `ai_instructions:` would
  // simply drop its dist route while the build kept reporting success. We
  // place a fixture daily yaml with an `ai_instructions:` block (which
  // `validateNoSourceAiInstructions` rejects), run `pnpm --filter manual
  // build`, and expect the subprocess to exit non-zero with the validator's
  // error text in stderr.
  //
  // Cleanup is wrapped in `try { ... } finally { unlinkSync(...) }` so a
  // crashed test never leaves a poisonous fixture in `data/daily/` that would
  // break every subsequent run of the rest of this suite.

  it('exits non-zero and propagates the validator throw when a daily yaml carries ai_instructions', () => {
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    const fixturePath = join(DAILY_DIR, `_test-fixture-${stamp}.yaml`)
    const fixtureYaml =
      `meta:\n` +
      `  version: test-fixture-${stamp}\n` +
      `  type: daily\n` +
      `modules: {}\n` +
      `ai_instructions:\n` +
      `  decoy_key:\n` +
      `    - decoy attempt that should be rejected at build time\n`
    writeFileSync(fixturePath, fixtureYaml)
    try {
      let exitCode: number | null = 0
      let stderr = ''
      let stdout = ''
      try {
        execFileSync('pnpm', ['--filter', 'manual', 'build'], {
          cwd: resolve(__dirname, '../..'),
          stdio: 'pipe',
        })
      } catch (err) {
        const e = err as { status?: number | null; stderr?: Buffer; stdout?: Buffer }
        exitCode = e.status ?? null
        stderr = e.stderr?.toString() ?? ''
        stdout = e.stdout?.toString() ?? ''
      }
      expect(
        exitCode,
        `build should exit non-zero when a daily yaml is invalid; got exit ${exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`
      ).not.toBe(0)
      // The validator error text mentions the offending source-level key.
      const combined = `${stdout}\n${stderr}`
      expect(combined, 'validator error text must surface in build output').toMatch(
        /ai_instructions/
      )
    } finally {
      if (existsSync(fixturePath)) unlinkSync(fixturePath)
    }
  })
})

describe('source yaml symbols block is rejected (build-time fail-loud)', () => {
  // Symbol descriptions live only in the `shared/symbols.ts` SYMBOLS SSOT;
  // `build.ts` injects them into the HTML-embedded yaml at build time and
  // never into the dist raw yaml (Option C: descriptions stay HTML-only so
  // the AI's `?format=yaml` fetch path never sees human-readable
  // descriptions). `validateNoSourceSymbols` is the gate that rejects any
  // source YAML that tries to carry its own `symbols:` block — without the
  // gate, a source-level copy would both shadow the SSOT and leak through
  // the `{ ...parsed, ai_instructions: AI_INSTRUCTIONS }` spread into the
  // dist raw yaml. This block locks the fail-loud contract in parallel to
  // the `ai_instructions` validator above.

  it('throws when manual carries a source-level symbols block', () => {
    const fixture = {
      meta: { version: 'fixture-symbols-v1' },
      modules: {},
      symbols: { decoy_id: { description: 'decoy attempt' } },
    }
    expect(() => validateNoSourceSymbols(fixture)).toThrow(/symbols/)
    expect(() => validateNoSourceSymbols(fixture)).toThrow(/source YAML/i)
  })

  it('passes silently when manual has no symbols block', () => {
    const fixture = {
      meta: { version: 'fixture-symbols-v2' },
      modules: {},
    }
    expect(() => validateNoSourceSymbols(fixture)).not.toThrow()
  })
})

describe('manual build fails non-zero when a daily yaml contains a source symbols block', () => {
  // End-to-end parallel to the `ai_instructions` daily-loop test above: the
  // daily-build loop in `build.ts` MUST surface a `validateNoSourceSymbols`
  // throw as a non-zero process exit. We place a fixture daily yaml with a
  // `symbols:` block, run `pnpm --filter manual build`, and expect the
  // subprocess to exit non-zero with the validator's error text in the
  // combined stdout+stderr. Cleanup is wrapped in `try { ... } finally
  // { unlinkSync(...) }` so a crashed test never leaves a poisonous fixture
  // in `data/daily/` that would break every subsequent run of this suite.

  it('exits non-zero and propagates the validator throw when a daily yaml carries symbols', () => {
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    const fixturePath = join(DAILY_DIR, `_test-fixture-symbols-${stamp}.yaml`)
    const fixtureYaml =
      `meta:\n` +
      `  version: test-fixture-symbols-${stamp}\n` +
      `  type: daily\n` +
      `modules: {}\n` +
      `symbols:\n` +
      `  decoy_id:\n` +
      `    description: decoy attempt that should be rejected at build time\n`
    writeFileSync(fixturePath, fixtureYaml)
    try {
      let exitCode: number | null = 0
      let stderr = ''
      let stdout = ''
      try {
        execFileSync('pnpm', ['--filter', 'manual', 'build'], {
          cwd: resolve(__dirname, '../..'),
          stdio: 'pipe',
        })
      } catch (err) {
        const e = err as { status?: number | null; stderr?: Buffer; stdout?: Buffer }
        exitCode = e.status ?? null
        stderr = e.stderr?.toString() ?? ''
        stdout = e.stdout?.toString() ?? ''
      }
      expect(
        exitCode,
        `build should exit non-zero when a daily yaml carries a symbols block; got exit ${exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`
      ).not.toBe(0)
      // The validator error text mentions the offending source-level key.
      const combined = `${stdout}\n${stderr}`
      expect(combined, 'validator error text must surface in build output').toMatch(/symbols/)
    } finally {
      if (existsSync(fixturePath)) unlinkSync(fixturePath)
    }
  })
})
