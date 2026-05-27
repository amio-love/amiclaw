import { describe, expect, it, beforeAll } from 'vitest'
import { collectReferencedSymbols, validateManualSymbols, type Manual } from '@shared/manual-schema'
import { SYMBOLS } from '@shared/symbols'
import yaml from 'js-yaml'
import { readFileSync, readdirSync } from 'fs'
import { resolve, join } from 'path'
import { execFileSync } from 'child_process'

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
