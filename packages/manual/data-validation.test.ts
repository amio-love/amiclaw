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
