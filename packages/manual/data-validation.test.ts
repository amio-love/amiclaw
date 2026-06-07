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

describe('source YAMLs ship no symbols block (Option C source invariant)', () => {
  // Source YAMLs must never author a `symbols:` block — descriptions are owned
  // by the `shared/symbols.ts` SSOT and injected at build time. (The BUILT
  // dist raw YAML now DOES carry the injected symbols so the AI's
  // `?format=yaml` path can disambiguate ids — that is asserted in
  // 'AI-served payload (dist raw YAML) carries injected symbols' below.)
  beforeAll(() => {
    buildManualForTests()
  })

  it('practice.yaml source has no top-level symbols block', () => {
    const parsed = yaml.load(readFileSync(PRACTICE_YAML, 'utf8')) as Record<string, unknown>
    expect(parsed.symbols).toBeUndefined()
  })

  it('every daily YAML source has no top-level symbols block', () => {
    const dailyFiles = readdirSync(DAILY_DIR).filter((f) => f.endsWith('.yaml'))
    expect(dailyFiles.length).toBeGreaterThan(0)
    for (const file of dailyFiles) {
      const sourceParsed = yaml.load(readFileSync(join(DAILY_DIR, file), 'utf8')) as Record<
        string,
        unknown
      >
      expect(sourceParsed.symbols, `source ${file} should not ship a symbols block`).toBeUndefined()
    }
  })
})

describe('AI-served payload (dist raw YAML) carries injected symbols (AI disambiguation path)', () => {
  // New invariant (reverses the prior Option-C dist-raw rule): the dist raw
  // YAML is the payload the AI fetches via `?format=yaml` / `Accept:
  // text/plain`. It MUST carry a `symbols:` block whose descriptions are
  // character-equal to the `shared/symbols.ts` SSOT for every id the manual
  // references — otherwise the AI sees bare ids (`psi`, `trident`, `omega`)
  // with no shape vocabulary and mis-identifies symbols. The HTML path already
  // had this; this guard locks it onto the plain-text AI path too.
  beforeAll(() => {
    buildManualForTests()
  })

  const SSOT_DESCRIPTIONS: Map<string, string> = new Map(SYMBOLS.map((s) => [s.id, s.description]))

  function assertDistRawSymbols(label: string, distRawPath: string): string[] {
    const errors: string[] = []
    const manual = yaml.load(readFileSync(distRawPath, 'utf8')) as Manual
    const symbols = manual.symbols
    if (symbols === undefined) {
      errors.push(
        `${label}: dist raw YAML has NO symbols block — the AI path cannot disambiguate ids`
      )
      return errors
    }
    const referenced = collectReferencedSymbols(manual.modules)
    for (const id of referenced) {
      const entry = symbols[id]
      if (!entry || typeof entry.description !== 'string' || entry.description.length === 0) {
        errors.push(
          `${label}: referenced symbol '${id}' missing a non-empty description in dist raw symbols block`
        )
        continue
      }
      const ssot = SSOT_DESCRIPTIONS.get(id)
      if (entry.description !== ssot) {
        errors.push(
          `${label}: symbol '${id}' dist-raw description differs from shared/symbols.ts SSOT.\n` +
            `  dist raw: ${JSON.stringify(entry.description)}\n` +
            `  SYMBOLS:  ${JSON.stringify(ssot)}`
        )
      }
    }
    return errors
  }

  it('practice dist raw YAML carries SSOT-equal symbol descriptions for every referenced id', () => {
    const errors = assertDistRawSymbols('practice', join(MANUAL_DIST, 'data/practice.yaml'))
    expect(errors, `\n${errors.join('\n')}`).toEqual([])
  })

  it('every daily dist raw YAML carries SSOT-equal symbol descriptions for every referenced id', () => {
    const dailyFiles = readdirSync(DAILY_DIR).filter((f) => f.endsWith('.yaml'))
    expect(dailyFiles.length).toBeGreaterThan(0)
    const errors: string[] = []
    for (const file of dailyFiles) {
      errors.push(...assertDistRawSymbols(`daily ${file}`, join(MANUAL_DIST, 'data', file)))
    }
    expect(errors, `\n${errors.join('\n')}`).toEqual([])
  })

  it('dist raw YAML orders ai_instructions before modules (framing-first)', () => {
    // The AI reads the plain-text payload top-to-bottom; its role + the
    // do-not-reveal rules + collaboration philosophy (in ai_instructions) must
    // land BEFORE any module rule content. Assert on the raw text positions of
    // the top-level (column-0) keys, which is exactly what the AI reads.
    const raw = readFileSync(join(MANUAL_DIST, 'data/practice.yaml'), 'utf8')
    const aiIdx = raw.search(/^ai_instructions:/m)
    const modIdx = raw.search(/^modules:/m)
    expect(
      aiIdx,
      'ai_instructions: top-level key missing from dist raw YAML'
    ).toBeGreaterThanOrEqual(0)
    expect(modIdx, 'modules: top-level key missing from dist raw YAML').toBeGreaterThanOrEqual(0)
    expect(
      aiIdx,
      'ai_instructions must appear before modules so the AI reads its role before any rule'
    ).toBeLessThan(modIdx)
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

describe('rendered practice manual is scoped to the practice-active module set', () => {
  // Practice gameplay runs only wire_routing + keypad (MODULE_SEQUENCE.practice
  // in packages/game-bombsquad/src/store/game-context.tsx — practice:
  // ['wire','keypad']). The source practice.yaml keeps all four modules (the
  // daily generator derives every daily manual from it, and the frontend parses
  // the full source), but build.ts scopes the RENDERED practice manual to the
  // practice-active set so the AI never loads — and so can never confidently
  // match against — rules for a module (星盘/symbol_dial, 按钮/button) a practice
  // run cannot present. This guards BOTH render paths (dist raw YAML + the
  // HTML-embedded yaml, which build.ts serialises from one canonical payload)
  // and confirms the scoping is practice-only: every daily manual still ships
  // all four modules, and the practice render keeps decoy_modules.
  beforeAll(() => {
    buildManualForTests()
  })

  // Sorted alphabetically to match Object.keys(...).sort() below.
  const PRACTICE_ACTIVE = ['keypad', 'wire_routing']
  const DAILY_ALL = ['button', 'keypad', 'symbol_dial', 'wire_routing']

  function distRawModuleKeys(distRawPath: string): string[] {
    const manual = yaml.load(readFileSync(distRawPath, 'utf8')) as Manual
    return Object.keys(manual.modules).sort()
  }

  function embeddedModuleKeys(htmlPath: string): string[] {
    const html = readFileSync(htmlPath, 'utf8')
    const m = html.match(/<pre class="anti-human">([\s\S]*?)<\/pre>/)
    if (!m) throw new Error(`No <pre class="anti-human"> block found in ${htmlPath}`)
    const manual = yaml.load(m[1]) as Manual
    return Object.keys(manual.modules).sort()
  }

  it('practice dist raw YAML modules are exactly { wire_routing, keypad }', () => {
    expect(distRawModuleKeys(join(MANUAL_DIST, 'data/practice.yaml'))).toEqual(PRACTICE_ACTIVE)
  })

  it('practice HTML-embedded yaml modules are exactly { wire_routing, keypad }', () => {
    expect(embeddedModuleKeys(join(MANUAL_DIST, 'practice/index.html'))).toEqual(PRACTICE_ACTIVE)
  })

  it('practice render drops symbol_dial and button (no stale module rules reach the AI)', () => {
    const keys = distRawModuleKeys(join(MANUAL_DIST, 'data/practice.yaml'))
    expect(keys, 'symbol_dial must not ship in the practice render').not.toContain('symbol_dial')
    expect(keys, 'button must not ship in the practice render').not.toContain('button')
  })

  it('practice render still carries decoy_modules (universal fake-module content)', () => {
    const manual = yaml.load(
      readFileSync(join(MANUAL_DIST, 'data/practice.yaml'), 'utf8')
    ) as Manual & { decoy_modules?: unknown }
    expect(manual.decoy_modules, 'decoy_modules must survive the practice scoping').toBeDefined()
  })

  it('every daily dist raw YAML still ships all four modules (scoping is practice-only)', () => {
    const dailyFiles = readdirSync(DAILY_DIR).filter((f) => f.endsWith('.yaml'))
    expect(dailyFiles.length).toBeGreaterThan(0)
    for (const file of dailyFiles) {
      expect(
        distRawModuleKeys(join(MANUAL_DIST, 'data', file)),
        `${file} should still carry all four modules`
      ).toEqual(DAILY_ALL)
    }
  })
})

describe('AI_INSTRUCTIONS carries game framing + collaboration philosophy', () => {
  // build.ts injects AI_INSTRUCTIONS into the HTML-embedded yaml AND the dist
  // raw yaml on every render. This block locks in the required-key schema
  // (`game_overview` leading with a whole-game mental model, then `game_context`,
  // `retain_manual_in_session` — read the manual once and keep it in working
  // memory, never re-fetch the link every turn — the two tactical-output keys,
  // `collaboration_philosophy`, and `recover_after_failure` — the
  // anti-role-reversal failsafe for the moment a player reports a failed
  // action) so the AI grasps what BombSquad is and receives full game context
  // before any rule content, on every manual fetch, in either consumption path.
  // (`post_game_recap` is a sibling injected key guarded by its own dedicated
  // test below, not part of REQUIRED_KEYS.)
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
    'game_overview',
    'do_not_reveal_to_player',
    'give_conclusions_not_reasoning',
    'game_context',
    'retain_manual_in_session',
    'collaboration_philosophy',
    'recover_after_failure',
  ] as const

  it('practice manual HTML embedded yaml ai_instructions contains all required keys', () => {
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

  it('framing and philosophy values carry the load-bearing Chinese tokens', () => {
    // AI_INSTRUCTIONS is now all-Chinese (unifying the manual to one language —
    // rules + symbol descriptions are already Chinese). These tokens are the
    // Chinese equivalents of the prior English anchors (voice / describe /
    // uncertain / recap). The cross-round memory framing is asserted separately
    // in 'game_overview leads with a whole-game mental model …' below.
    const manual = extractEmbeddedYaml(join(MANUAL_DIST, 'practice/index.html'))
    const instructions = manual.ai_instructions ?? {}

    // game_context names the voice-only medium — the physical anchor for the
    // trust-building loop and the manual's role as the only AI-facing surface.
    const gameContextText = (instructions.game_context ?? []).join('\n')
    expect(gameContextText, 'game_context must name the voice-only medium').toMatch(/语音/)

    // collaboration_philosophy must (a) tell the AI to ask the player to
    // describe shapes instead of guessing dictionary names, (b) call for
    // admitting uncertainty before guessing, and (c) anchor trust-loop data
    // source to the BombSquad app-rendered recap (NOT voice-conversation
    // replay — that would violate the zero-integration principle).
    const philosophyText = (instructions.collaboration_philosophy ?? []).join('\n')
    expect(
      philosophyText,
      'collaboration_philosophy must invite the player to describe shapes'
    ).toMatch(/描述/)
    expect(philosophyText, 'collaboration_philosophy must call for admitting uncertainty').toMatch(
      /不确定/
    )
    expect(
      philosophyText,
      'collaboration_philosophy must anchor trust-loop data source to the app-rendered recap'
    ).toMatch(/复盘/)
  })

  it('game_overview leads with a whole-game mental model and corrects the memory framing', () => {
    // Finding 2: the manual jumped straight into the AI's role + per-module rule
    // tables and never told the AI what BombSquad IS as a whole. game_overview
    // is a dedicated key placed FIRST so the AI reads a concise whole-game model
    // (what it is / how a run flows / the scene info bar / timer + fail / the
    // collaborate loop / decoy modules) before anything else.
    const manual = extractEmbeddedYaml(join(MANUAL_DIST, 'practice/index.html'))
    const instructions = manual.ai_instructions ?? {}

    // game_overview must be the very first ai_instructions key (the first thing
    // the AI reads top-to-bottom).
    const firstKey = Object.keys(instructions)[0]
    expect(firstKey, 'game_overview must be the first ai_instructions key').toBe('game_overview')

    // game_overview must carry the core game-mechanics vocabulary so the AI's
    // mental model covers the run loop (模块 / 拆完), the count-UP stopwatch
    // (计时 / 正计时 — the timer no longer counts down), and the daily fail rule
    // (失误 — now the ONLY daily fail path, since time is a score not a
    // detonator).
    const overviewText = (instructions.game_overview ?? []).join('\n')
    expect(overviewText, 'game_overview must name the count-up stopwatch (正计时/计时)').toMatch(
      /正计时|计时/
    )
    expect(overviewText, 'game_overview must name the strike/fail mechanic').toMatch(/失误/)
    expect(overviewText, 'game_overview must name the module structure').toMatch(/模块/)
    expect(overviewText, 'game_overview must convey clearing all modules to win').toMatch(/拆完/)
    // The obsolete countdown framing must be gone — time no longer detonates.
    expect(overviewText, 'game_overview must NOT call the timer a countdown (倒计时)').not.toMatch(
      /倒计时/
    )

    // Finding 3: the old "every fetch = a fresh game / no memory of any prior
    // session / never claim to remember the last round" framing was WRONG — the
    // player plays multiple rounds inside ONE continuous voice conversation, so
    // the AI DOES remember earlier rounds and SHOULD use that. The corrected
    // framing lives in game_context: same-conversation memory exists and should
    // be used (同一对话 / 记得), while each round's puzzle is re-randomized so the
    // AI must not assume carry-over (重新随机).
    const gameContextText = (instructions.game_context ?? []).join('\n')
    expect(
      gameContextText,
      'game_context must state the AI shares one continuous conversation with the player'
    ).toMatch(/同一对话/)
    expect(
      gameContextText,
      'game_context must tell the AI it remembers earlier rounds in this conversation'
    ).toMatch(/记得/)
    expect(
      gameContextText,
      'game_context must tell the AI each round is re-randomized (no carry-over assumption)'
    ).toMatch(/重新随机/)

    // The obsolete fresh-game claim must be gone everywhere in ai_instructions.
    const allText = Object.values(instructions).flat().join('\n')
    expect(allText, 'the obsolete "全新的游戏" fresh-game framing must be removed').not.toMatch(
      /全新的游戏/
    )
  })

  it('every ai_instructions entry is Chinese (carries at least one CJK character)', () => {
    // The manual is unified to all-Chinese; an English-only entry would be a
    // regression. Assert every entry of every key carries a CJK ideograph.
    const CJK_REGEX = /[一-鿿]/
    const manual = extractEmbeddedYaml(join(MANUAL_DIST, 'practice/index.html'))
    const instructions = manual.ai_instructions ?? {}
    const offenders: string[] = []
    for (const key of REQUIRED_KEYS) {
      const entries = instructions[key] ?? []
      entries.forEach((entry, i) => {
        if (!CJK_REGEX.test(entry)) offenders.push(`${key}[${i}]: ${JSON.stringify(entry)}`)
      })
    }
    expect(
      offenders,
      `ai_instructions entries with no Chinese character:\n  ${offenders.join('\n  ')}`
    ).toEqual([])
  })

  it('carries the global "sole manual holder" role-discipline framing', () => {
    // Promoted out of the dial preamble into GLOBAL ai_instructions so the
    // discipline (you hold the manual; never bounce a rule/target question back
    // to the player; turn every lookup into one executable action) governs all
    // four modules, not just the dial.
    const manual = extractEmbeddedYaml(join(MANUAL_DIST, 'practice/index.html'))
    const allText = Object.values(manual.ai_instructions ?? {})
      .flat()
      .join('\n')
    expect(allText, 'ai_instructions must state the AI is the sole manual holder').toMatch(
      /唯一持有手册/
    )
    expect(allText, 'ai_instructions must forbid bouncing lookups back to the player').toMatch(
      /绝不反问/
    )
  })

  it('game_context frames practice-vs-daily mode and practice-mode onboarding', () => {
    // Core design goal: in practice mode the AI must onboard a possible
    // first-timer through the collaboration loop. game_context must name both
    // meta.type modes, mark practice as the newbie-onboarding mode, and point
    // the player at the scene info bar to read out.
    const manual = extractEmbeddedYaml(join(MANUAL_DIST, 'practice/index.html'))
    const gameContextText = (manual.ai_instructions?.game_context ?? []).join('\n')
    expect(gameContextText, 'game_context must distinguish the practice mode').toMatch(/practice/)
    expect(gameContextText, 'game_context must distinguish the daily mode').toMatch(/daily/)
    expect(
      gameContextText,
      'game_context must frame practice mode as onboarding a possible first-timer'
    ).toMatch(/新手/)
    expect(
      gameContextText,
      'game_context must point the player at the scene info bar to read out'
    ).toMatch(/场景信息栏/)
  })

  it('game_context makes opening scene-bar collection a both-modes load-efficiency step (not practice-only onboarding)', () => {
    // The scene-info bar read-out at the opening was previously coupled to the
    // practice-only newbie-onboarding tone. It is decoupled into a load-bearing
    // efficiency discipline that applies to BOTH modes: in either mode the AI
    // asks the player to read the whole scene bar (序号 / 电池 / 指示灯) once at
    // the start, then reuses those global values all run, never re-asking.
    // Only the patient teaching tone stays practice-only.
    const manual = extractEmbeddedYaml(join(MANUAL_DIST, 'practice/index.html'))
    const gameContextText = (manual.ai_instructions?.game_context ?? []).join('\n')
    // Names the scene-bar collection as applying to both modes (practice + daily).
    expect(
      gameContextText,
      'game_context must mark opening scene-bar collection as both-modes (practice + daily)'
    ).toMatch(/不论\s*practice\s*还是\s*daily|两种模式/)
    // The reuse-don't-re-ask discipline: collect once, reuse all run.
    expect(
      gameContextText,
      'game_context must tell the AI to collect the scene bar once and reuse it (not re-ask)'
    ).toMatch(/复用|绝不反复追问|问一次/)
    // Still points at the scene info bar contents the player reads out.
    expect(
      gameContextText,
      'game_context must still name the scene-bar contents (电池 / 指示灯)'
    ).toMatch(/电池/)
  })

  it('post_game_recap instructs the AI to proactively run an end-of-round debrief', () => {
    // The endgame settlement rework moved the post-game recap from a player-copied
    // summary into an AI-initiated debrief. AI_INSTRUCTIONS gains a dedicated
    // `post_game_recap` key telling the AI to: infer the round ended from the
    // player's own words (NOT any app signal — zero-integration), proactively
    // start the debrief (ask 2-3 targeted questions + give actionable advice +
    // invite another round), and rely only on its conversation memory (the page
    // owns the exact numbers, the AI owns the qualitative coaching).
    const manual = extractEmbeddedYaml(join(MANUAL_DIST, 'practice/index.html'))
    const recap = manual.ai_instructions?.post_game_recap ?? []
    expect(recap.length, 'post_game_recap must be a non-empty string[]').toBeGreaterThan(0)
    const recapText = recap.join('\n')
    // The AI proactively starts the recap rather than waiting for the player.
    expect(recapText, 'post_game_recap must tell the AI to proactively start the recap').toMatch(
      /主动/
    )
    expect(recapText, 'post_game_recap must have the AI ask targeted questions').toMatch(/问/)
    // The AI invites the player into another round to close the improvement loop.
    expect(recapText, 'post_game_recap must invite another round').toMatch(/再开一局|再来一局/)
    // The round-end is sensed from the player's spoken result, not an app signal —
    // the zero-integration invariant.
    expect(
      recapText,
      'post_game_recap must sense round-end from the player, not an app signal'
    ).toMatch(/app 不会给你发任何结束信号/)
  })

  it('do_not_reveal_to_player separates process guidance from spoiling the answer', () => {
    // The onboarding push must not collide with the anti-spoiler discipline:
    // process guidance (how the flow goes, what to describe, how to cooperate)
    // is orthogonal to leaking answers/rule-text/why. This caveat lives in
    // do_not_reveal_to_player so the AI reads it right where the strict
    // anti-spoiler rules are stated.
    const manual = extractEmbeddedYaml(join(MANUAL_DIST, 'practice/index.html'))
    const text = (manual.ai_instructions?.do_not_reveal_to_player ?? []).join('\n')
    expect(text, 'must name process guidance as distinct from spoiling').toMatch(/流程引导/)
    expect(text, 'must state process guidance is not spoiling the answer').toMatch(/剧透/)
  })

  it('recover_after_failure is the anti-role-reversal failsafe for the post-failure moment', () => {
    // A capable manual-reading AI, after a player reports a failed action (wrong
    // cut / strike / detonation), reverse-asked the player for the rules — even
    // though the existing do_not_reveal_to_player ban already forbids bouncing a
    // lookup back to the player. That ban was not salient enough at the
    // post-failure moment, so AI_INSTRUCTIONS gains a dedicated 6th key
    // `recover_after_failure` that fires precisely then: never reverse-ask the
    // player, re-walk the rules yourself from the scene already described
    // (checking for missed scene info / rule-order violations), give one
    // corrected executable action, and stay fully in role.
    const manual = extractEmbeddedYaml(join(MANUAL_DIST, 'practice/index.html'))
    const recover = manual.ai_instructions?.recover_after_failure ?? []
    expect(recover.length, 'recover_after_failure must be a non-empty string[]').toBeGreaterThan(0)
    const text = recover.join('\n')
    // The failure trigger vocabulary so the AI knows this fires at the
    // post-failure moment.
    expect(
      text,
      'recover_after_failure must name the failure trigger (剪错 / 失误 / 爆炸)'
    ).toMatch(/剪错|失误|爆炸/)
    // The core anti-role-reversal ban: never reverse-ask the player for the
    // rules / manual / right answer.
    expect(
      text,
      'recover_after_failure must forbid reverse-asking the player for the rules'
    ).toMatch(/绝不反问/)
    // The corrective discipline: re-walk the rules yourself.
    expect(text, 'recover_after_failure must tell the AI to re-walk the rules itself').toMatch(
      /重新走/
    )
    // Self-check for the two most common error causes named in the spec:
    // missed scene info and rule-order violation.
    expect(text, 'recover_after_failure must have the AI self-check for missed scene info').toMatch(
      /电池|指示灯|场景信息/
    )
    expect(
      text,
      'recover_after_failure must have the AI self-check for a rule-order violation'
    ).toMatch(/顺序|跳到|跳过/)
    // Stay fully in role.
    expect(text, 'recover_after_failure must tell the AI to stay in role').toMatch(/角色/)
  })

  it('retain_manual_in_session tells the AI to read the manual once and never re-fetch the link', () => {
    // An AI that can read the manual was re-opening the link every turn —
    // wasting latency / tokens and risking a mid-run fetch failure.
    // AI_INSTRUCTIONS gains a dedicated `retain_manual_in_session` key,
    // inserted right after game_context (before do_not_reveal_to_player), that
    // tells the AI to read the whole manual ONCE at the start, keep it in
    // working memory for the whole conversation, and never re-open / re-fetch
    // the unchanging manual link on later turns. These tokens are the
    // load-bearing semantics; weakening any of them would let the re-fetch
    // behaviour creep back.
    const manual = extractEmbeddedYaml(join(MANUAL_DIST, 'practice/index.html'))
    const retain = manual.ai_instructions?.retain_manual_in_session ?? []
    expect(retain.length, 'retain_manual_in_session must be a non-empty string[]').toBeGreaterThan(
      0
    )
    const text = retain.join('\n')
    // (a) keep the manual in working memory across the whole session.
    expect(text, 'retain_manual_in_session must tell the AI to keep the manual in memory').toMatch(
      /记在|记住/
    )
    expect(text, 'retain_manual_in_session must scope the retention to the whole session').toMatch(
      /整局|整段对话/
    )
    // (b) never re-open / re-fetch the unchanging manual link every turn.
    expect(
      text,
      'retain_manual_in_session must forbid re-fetching / re-opening the link every turn'
    ).toMatch(/重新打开|重新抓取|重抓/)
  })

  it('retain_manual_in_session sits right after game_context (before do_not_reveal_to_player)', () => {
    // Framing position is load-bearing: the retention discipline must land
    // immediately after the role framing (game_context) and before the
    // anti-spoiler rules, so the AI reads "read once, keep in memory" right
    // where it first learns its role. This pins the relative position so a
    // future reorder of the surrounding keys is caught here too (the absolute
    // 8-key lock lives in the dedicated order test below).
    const manual = extractEmbeddedYaml(join(MANUAL_DIST, 'practice/index.html'))
    const keys = Object.keys(manual.ai_instructions ?? {})
    const ctxIdx = keys.indexOf('game_context')
    const retainIdx = keys.indexOf('retain_manual_in_session')
    const revealIdx = keys.indexOf('do_not_reveal_to_player')
    expect(retainIdx, 'retain_manual_in_session must be present').toBeGreaterThanOrEqual(0)
    expect(retainIdx, 'retain_manual_in_session must come right after game_context').toBe(
      ctxIdx + 1
    )
    expect(
      retainIdx,
      'retain_manual_in_session must come before do_not_reveal_to_player'
    ).toBeLessThan(revealIdx)
  })

  it('ai_instructions keys land in the locked framing-first order ending with recover_after_failure', () => {
    // The framing-first ordering invariant: the AI reads the payload
    // top-to-bottom, so the key order is load-bearing. game_overview leads
    // (whole-game mental model), then game_context (role + medium),
    // retain_manual_in_session (read once, keep in memory, never re-fetch the
    // link), the two tactical-output keys, collaboration_philosophy,
    // post_game_recap, and finally recover_after_failure — the post-failure
    // failsafe sits last, grouped with the other end-of-round / post-action
    // concern. This locks the exact insertion order build.ts emits so a future
    // reorder is caught.
    const manual = extractEmbeddedYaml(join(MANUAL_DIST, 'practice/index.html'))
    const keys = Object.keys(manual.ai_instructions ?? {})
    expect(keys, 'ai_instructions key order must match the locked framing-first sequence').toEqual([
      'game_overview',
      'game_context',
      'retain_manual_in_session',
      'do_not_reveal_to_player',
      'give_conclusions_not_reasoning',
      'collaboration_philosophy',
      'post_game_recap',
      'recover_after_failure',
    ])
  })
})

describe('wire_routing preamble carries the three readability-trap hardenings', () => {
  // A capable manual-reading AI, on the all-yellow repro scene (4 yellow wires,
  // battery 4), produced a wrong cut and then reverse-asked the player for the
  // rules. Root cause was a manual-content readability trap, not a logic bug —
  // solver.ts and the published rules agree on the answer (rule#2
  // battery_count>2 → position 2). The wire_routing.rule preamble carries three
  // hardened elements so a literal, time-pressured AI reader walks the rules
  // correctly: (a) strict top-down first-match-wins, (b) the color-filter
  // STRUCTURAL guarantee, (c) the scene-info ask-gate. Element (b) was
  // superseded by fix-manual-color-filter-controlflow: the offending yellow
  // rule's condition gained `count_red: {gt: 0}`, removing the manual's sole
  // match-then-fall-through control flow at the source, so the preamble no
  // longer teaches a "skip on color absence" example and instead states the
  // structural guarantee (a color-targeted rule's condition ensures that color
  // is present → the target is always resolvable) while still forbidding
  // arbitrary color substitution. These guards run over practice.yaml AND every
  // daily file (the preamble is carried verbatim by the deterministic daily
  // generator), so a future practice edit that drops an element — or a stale
  // daily that predates the edit — fails loudly.
  function loadWirePreamble(path: string): string {
    const manual = yaml.load(readFileSync(path, 'utf8')) as Manual
    const rule = (manual.modules as unknown as { wire_routing?: { rule?: string } }).wire_routing
      ?.rule
    expect(typeof rule, `${path}: wire_routing.rule must be a string`).toBe('string')
    return rule as string
  }

  function assertWirePreambleHardenings(label: string, rule: string): void {
    // Element (a): emphatic STRICT top-down first-match-wins — walk in listed
    // order, the FIRST rule whose conditions ALL hold wins, do NOT jump to the
    // rule that looks most relevant to a salient feature.
    expect(rule, `${label}: must emphasise a STRICT walk (严格)`).toMatch(/严格/)
    expect(rule, `${label}: must name the top-down walk direction`).toMatch(
      /自上而下|从上到下|从上往下/
    )
    expect(rule, `${label}: must forbid jumping ahead`).toMatch(/不要跳|绝不跳|不可跳|别跳/)
    expect(rule, `${label}: anti-jump must name the salient-feature trap object`).toMatch(
      /显眼|最相关|最像|最突出/
    )

    // Element (b): color-filter is a STRUCTURAL guarantee, not a skip control
    // flow. The match-then-fall-through hazard was removed at the source — the
    // offending yellow rule's condition gained `count_red: {gt: 0}`, so every
    // color-targeted wire rule's condition now guarantees the target color is
    // present and the target is always resolvable. The preamble must (1) reframe
    // color-filter as that structural guarantee (condition 已保证该色存在), (2)
    // still forbid arbitrary color substitution (绝不擅自换色), and (3) NO LONGER
    // carry the dead all-yellow "skip to the next rule" example (绝不改成剪黄) —
    // the structural fix makes that fall-through impossible. (The machine-checked
    // structural invariant itself is guarded by
    // e2e/regression/fix-manual-color-filter-controlflow.assert.mjs.)
    expect(
      rule,
      `${label}: must reframe color-filter as a structural guarantee (condition 已保证该色存在)`
    ).toMatch(/condition 已保证|condition 必保证|已保证该色存在|保证该色至少/)
    expect(rule, `${label}: must forbid arbitrary color substitution (绝不擅自换色)`).toMatch(
      /绝不擅自换色|绝不擅自把要剪的颜色换成|不得擅自换色/
    )
    expect(
      rule,
      `${label}: must NOT carry the dead all-yellow skip example (改成剪黄) — the structural fix removed that fall-through`
    ).not.toMatch(/改成剪黄/)

    // Element (c): scene-info ask-gate — rules can depend on battery /
    // indicators; if the AI lacks the value it must ASK the player before
    // answering, never guess.
    expect(rule, `${label}: scene-info gate must name 电池`).toMatch(/电池/)
    expect(rule, `${label}: scene-info gate must name 指示灯`).toMatch(/指示灯/)
    expect(rule, `${label}: must instruct the AI to ASK the player for missing scene info`).toMatch(
      /问玩家|先问|向玩家确认|让玩家报|问一下玩家/
    )
    expect(rule, `${label}: must forbid guessing a scene-info-dependent answer`).toMatch(
      /不要猜|绝不靠猜|不能猜|别靠猜|不靠猜/
    )
  }

  it('practice.yaml wire_routing preamble carries all three hardened elements', () => {
    assertWirePreambleHardenings('practice.yaml', loadWirePreamble(PRACTICE_YAML))
  })

  it('every daily YAML wire_routing preamble carries all three hardened elements', () => {
    const dailyFiles = readdirSync(DAILY_DIR).filter((f) => f.endsWith('.yaml'))
    expect(dailyFiles.length).toBeGreaterThan(0)
    for (const file of dailyFiles) {
      assertWirePreambleHardenings(file, loadWirePreamble(join(DAILY_DIR, file)))
    }
  })

  it("today's daily wire preamble equals practice's (regen propagated the edit)", () => {
    // The daily generator carries the wire_routing.rule string verbatim
    // (structuredClone) — only rule ORDER is permuted. So every daily's wire
    // preamble must be character-equal to practice's. This catches a stale
    // daily that predates a practice preamble edit (regen not run / partial).
    const practiceRule = loadWirePreamble(PRACTICE_YAML)
    const dailyFiles = readdirSync(DAILY_DIR).filter((f) => f.endsWith('.yaml'))
    expect(dailyFiles.length).toBeGreaterThan(0)
    const offenders: string[] = []
    for (const file of dailyFiles) {
      const dailyRule = loadWirePreamble(join(DAILY_DIR, file))
      if (dailyRule !== practiceRule) offenders.push(file)
    }
    expect(
      offenders,
      `daily wire preambles differ from practice (stale — rerun gen:daily):\n  ${offenders.join('\n  ')}`
    ).toEqual([])
  })
})

describe('button preamble carries the two readability-trap hardenings', () => {
  // PR #114's wire bug fix also hardened the button module preamble against the
  // same literal, time-pressured-AI failure modes, but only wire got a CI-wired
  // vitest guard. The button preamble carries exactly TWO of the wire block's
  // three hardenings: (a) strict top-down first-match-wins with no salient jump,
  // and (b) the scene-info ask-gate. Button has NO color-filter-skip element —
  // button targets have no action-color mechanic — so there is no third element
  // to assert. These guards run over practice.yaml AND every daily file (the
  // preamble is carried verbatim by the deterministic daily generator, which
  // permutes only rule ORDER), so a future practice edit that drops an element —
  // or a stale daily that predates the edit — fails loudly.
  function loadButtonPreamble(path: string): string {
    const manual = yaml.load(readFileSync(path, 'utf8')) as Manual
    const rule = (manual.modules as unknown as { button?: { rule?: string } }).button?.rule
    expect(typeof rule, `${path}: button.rule must be a string`).toBe('string')
    return rule as string
  }

  function assertButtonPreambleHardenings(label: string, rule: string): void {
    // Element (a): emphatic STRICT top-down first-match-wins — walk in listed
    // order, the FIRST rule whose conditions ALL hold wins, do NOT jump to the
    // rule that looks most relevant to a salient feature (button color / label).
    expect(rule, `${label}: must emphasise a STRICT walk (严格)`).toMatch(/严格/)
    expect(rule, `${label}: must name the top-down walk direction`).toMatch(
      /自上而下|从上到下|从上往下/
    )
    // The button jump-negation is phrased "绝不…就跳到…那条规则" (the negated text
    // sits between 绝不 and 跳), so the wire block's `/绝不跳/` literal does NOT
    // match — this regex matches the button's actual phrasing.
    expect(rule, `${label}: must forbid jumping ahead`).toMatch(/绝不[^。]*跳到|不要跳|别跳|不可跳/)
    expect(rule, `${label}: anti-jump must name the salient-feature trap object`).toMatch(
      /显眼|最相关|最像|最突出/
    )

    // Element (b): scene-info ask-gate — rules can depend on battery /
    // indicators; if the AI lacks the value it must ASK the player before
    // answering, never guess.
    expect(rule, `${label}: scene-info gate must name 电池`).toMatch(/电池/)
    expect(rule, `${label}: scene-info gate must name 指示灯`).toMatch(/指示灯/)
    expect(rule, `${label}: must instruct the AI to ASK the player for missing scene info`).toMatch(
      /先问|问玩家|向玩家确认|让玩家报/
    )
    expect(rule, `${label}: must forbid guessing a scene-info-dependent answer`).toMatch(
      /绝不靠猜|不要猜|别靠猜|不靠猜/
    )
  }

  it('practice.yaml button preamble carries both hardened elements', () => {
    assertButtonPreambleHardenings('practice.yaml', loadButtonPreamble(PRACTICE_YAML))
  })

  it('every daily YAML button preamble carries both hardened elements', () => {
    const dailyFiles = readdirSync(DAILY_DIR).filter((f) => f.endsWith('.yaml'))
    expect(dailyFiles.length).toBeGreaterThan(0)
    for (const file of dailyFiles) {
      assertButtonPreambleHardenings(file, loadButtonPreamble(join(DAILY_DIR, file)))
    }
  })

  it("today's daily button preamble equals practice's (regen propagated the edit)", () => {
    // The daily generator carries the button.rule string verbatim
    // (structuredClone) — only rule ORDER is permuted. So every daily's button
    // preamble must be character-equal to practice's. This catches a stale daily
    // that predates a practice preamble edit (regen not run / partial).
    const practiceRule = loadButtonPreamble(PRACTICE_YAML)
    const dailyFiles = readdirSync(DAILY_DIR).filter((f) => f.endsWith('.yaml'))
    expect(dailyFiles.length).toBeGreaterThan(0)
    const offenders: string[] = []
    for (const file of dailyFiles) {
      const dailyRule = loadButtonPreamble(join(DAILY_DIR, file))
      if (dailyRule !== practiceRule) offenders.push(file)
    }
    expect(
      offenders,
      `daily button preambles differ from practice (stale — rerun gen:daily):\n  ${offenders.join('\n  ')}`
    ).toEqual([])
  })

  // The button.rule once overloaded「指示灯」for two physically distinct lights:
  // the scene's NAMED indicators (FRK etc., matched in rule conditions) and the
  // button's own press-and-hold RELEASE light (release_on_light — watch until it
  // turns the target color, then release). A literal manual-reading AI could
  // conflate them: watch the wrong light, or apply a scene indicator's color to
  // the release condition. The release light is now named「灯条」, terminologically
  // distinct from the scene「指示灯」(and aligned with build.ts's existing
  // 「等灯条变红再松手」). These four substrings were UNIQUE to the release-light
  // references — none appears in any scene-indicator reference — so this lock is
  // non-tautological and never touches the scene assertions above.
  const RELEASE_LIGHT_LEGACY_PHRASINGS = [
    '指示灯亮起',
    '指示灯变成',
    '指示灯会连续轮换',
    '指示灯并不会停',
  ]

  function assertReleaseLightRename(label: string, rule: string): void {
    // The release-light term is present.
    expect(rule, `${label}: release light must be named「灯条」`).toMatch(/灯条/)
    // None of the old release-light「指示灯」phrasings survive.
    for (const phrasing of RELEASE_LIGHT_LEGACY_PHRASINGS) {
      expect(
        rule.includes(phrasing),
        `${label}: release light must not be read as「指示灯」(found legacy phrasing「${phrasing}」)`
      ).toBe(false)
    }
  }

  it('practice.yaml button preamble names the release light「灯条」, not「指示灯」', () => {
    assertReleaseLightRename('practice.yaml', loadButtonPreamble(PRACTICE_YAML))
  })

  it('every daily button preamble names the release light「灯条」, not「指示灯」', () => {
    const dailyFiles = readdirSync(DAILY_DIR).filter((f) => f.endsWith('.yaml'))
    expect(dailyFiles.length).toBeGreaterThan(0)
    for (const file of dailyFiles) {
      assertReleaseLightRename(file, loadButtonPreamble(join(DAILY_DIR, file)))
    }
  })
})

describe('wire + button preambles carry the named-indicator absence equivalence clause', () => {
  // A capable manual-reading AI, on a round whose scene info bar lists some
  // indicators but NOT FRK, hit a gap: the wire/button rulebook names
  // indicator_FRK_lit, but FRK is one of 8 indicator labels and shows up in only
  // some rounds. The prior「只取被点名的指示灯，其余忽略」clause covers the OTHER
  // half (which indicators to ignore) but never says what to do when a *named*
  // indicator is itself absent this round. A literal AI could then stall
  // (repeatedly asking "is FRK lit?") or assume it lit. The wire and button
  // preambles gain the complementary clause: a named indicator absent from the
  // round's reported list counts as "not lit" — every condition requiring it lit
  // (indicator_FRK_lit: true) fails, first-match continues, never stall, never
  // assume lit — demarcated from the ask-gate (ask only when the player has not
  // yet reported indicators; once the round's indicators are fully reported and
  // FRK is not among them, it is known-absent = not lit, no need to re-ask). This
  // documents the rule engine's existing behavior verbatim: buildContext only
  // adds indicator_{label}_lit for PRESENT indicators, and matchCondition returns
  // false for an absent key — so no engine change is needed. The「未亮处理」framing
  // (not a static「该灯不存在=条件恒假」absolute) stays correct for any future
  // indicator_*_lit: false condition. The clause is carried verbatim into every
  // daily by the deterministic generator (only rule ORDER is permuted), so this
  // guard runs over practice + every daily: a future practice edit that drops it,
  // or a stale daily that predates it, fails loudly.
  function loadModulePreamble(path: string, moduleKey: 'wire_routing' | 'button'): string {
    const manual = yaml.load(readFileSync(path, 'utf8')) as Manual
    const rule = (manual.modules as unknown as Record<string, { rule?: string }>)[moduleKey]?.rule
    expect(typeof rule, `${path}: ${moduleKey}.rule must be a string`).toBe('string')
    return rule as string
  }

  function assertAbsenceClause(label: string, rule: string): void {
    // (1) Trigger: a named indicator NOT in the round's reported list = absent.
    expect(
      rule,
      `${label}: must name the absence trigger (不在玩家开局念出的那串指示灯里)`
    ).toMatch(/不在玩家开局念出的那串指示灯里/)
    // (2) Handling: treat an absent named indicator as "not lit" (未亮处理) — the
    // engine-faithful framing, NOT a static 恒假 absolute.
    expect(rule, `${label}: must treat an absent named indicator as not-lit (未亮)`).toMatch(/未亮/)
    // (3) The requiring-lit condition fails (不成立).
    expect(rule, `${label}: must state the requiring-lit condition fails (判为不成立)`).toMatch(
      /判为不成立|不成立/
    )
    // (4) First-match continues down the list — never stall on this rule.
    expect(
      rule,
      `${label}: must continue first-match down the list (first-match 继续往下走)`
    ).toMatch(/first-match 继续往下走|继续往下走|继续往下/)
    // (5) Never reverse-assume it is lit.
    expect(rule, `${label}: must forbid assuming it lit (绝不…假设它亮)`).toMatch(
      /绝不[^。]*假设它亮/
    )
    // (6) Ask-gate demarcation: once the round's indicators are fully reported and
    // it is not among them, it is known-absent — no need to ask again.
    expect(rule, `${label}: must demarcate from the ask-gate (报全)`).toMatch(/报全/)
    expect(rule, `${label}: must state no need to re-ask once known absent (无须再问)`).toMatch(
      /无须再问|无需再问/
    )
  }

  it('practice.yaml wire_routing preamble carries the absence equivalence clause', () => {
    assertAbsenceClause('practice.yaml wire', loadModulePreamble(PRACTICE_YAML, 'wire_routing'))
  })

  it('practice.yaml button preamble carries the absence equivalence clause', () => {
    assertAbsenceClause('practice.yaml button', loadModulePreamble(PRACTICE_YAML, 'button'))
  })

  it('every daily wire_routing preamble carries the clause and char-equals practice', () => {
    const practiceRule = loadModulePreamble(PRACTICE_YAML, 'wire_routing')
    const dailyFiles = readdirSync(DAILY_DIR).filter((f) => f.endsWith('.yaml'))
    expect(dailyFiles.length).toBeGreaterThan(0)
    const offenders: string[] = []
    for (const file of dailyFiles) {
      const rule = loadModulePreamble(join(DAILY_DIR, file), 'wire_routing')
      assertAbsenceClause(`daily ${file} wire`, rule)
      if (rule !== practiceRule) offenders.push(file)
    }
    expect(
      offenders,
      `daily wire preambles differ from practice (stale — rerun gen:daily):\n  ${offenders.join('\n  ')}`
    ).toEqual([])
  })

  it('every daily button preamble carries the clause and char-equals practice', () => {
    const practiceRule = loadModulePreamble(PRACTICE_YAML, 'button')
    const dailyFiles = readdirSync(DAILY_DIR).filter((f) => f.endsWith('.yaml'))
    expect(dailyFiles.length).toBeGreaterThan(0)
    const offenders: string[] = []
    for (const file of dailyFiles) {
      const rule = loadModulePreamble(join(DAILY_DIR, file), 'button')
      assertAbsenceClause(`daily ${file} button`, rule)
      if (rule !== practiceRule) offenders.push(file)
    }
    expect(
      offenders,
      `daily button preambles differ from practice (stale — rerun gen:daily):\n  ${offenders.join('\n  ')}`
    ).toEqual([])
  })
})

describe('keypad preamble carries the position-fallback hardening', () => {
  // The keypad (星符) module's only instruction channel used to be the symbol
  // NAME. When the visible 4-symbol set contains a known easily-confused pair
  // (trident+psi / hourglass+delta — self-flagged in shared/symbols.ts), "先点
  // 那个三叉戟" can land on the psi cell → mis-tap, and three mis-taps detonate
  // the daily bomb. That is identification noise, not design difficulty. The
  // keypad.rule preamble gains a position FALLBACK: symbol name stays the
  // DEFAULT channel, but on a confusable pair (or when the player can't tell two
  // similar shapes apart) the AI switches to grid quadrant (左上/右上/左下/右下)
  // as a stable, player-reported referent — decoupling "which cell" from "what
  // symbol" without touching the set→sequence lookup difficulty. These guards
  // run over practice.yaml AND every daily file (the preamble is carried
  // verbatim by the deterministic daily generator, which permutes only the
  // sequence rows), so a future practice edit that drops an element — or a stale
  // daily that predates the edit — fails loudly.
  function loadKeypadPreamble(path: string): string {
    const manual = yaml.load(readFileSync(path, 'utf8')) as Manual
    const rule = (manual.modules as unknown as { keypad?: { rule?: string } }).keypad?.rule
    expect(typeof rule, `${path}: keypad.rule must be a string`).toBe('string')
    return rule as string
  }

  function assertKeypadPositionFallback(label: string, rule: string): void {
    // (h) Symbol NAME stays the DEFAULT channel: keep the describe-the-shape /
    // align-to-name learning loop, and mark the symbol name as the default.
    expect(rule, `${label}: must keep the shape-description channel (描述 + 形状)`).toMatch(/描述/)
    expect(rule, `${label}: must keep the shape vocabulary (形状/笔画/弧线)`).toMatch(
      /形状|笔画|弧线/
    )
    expect(
      rule,
      `${label}: must mark the symbol name as the DEFAULT channel (默认 + 符号名)`
    ).toMatch(/默认/)
    expect(rule, `${label}: must name the symbol-name default channel (符号名)`).toMatch(/符号名/)
    // The set→unique-sequence lookup difficulty must be UNCHANGED.
    expect(rule, `${label}: must keep the set→sequence lookup framing (交集不超过 / 唯一)`).toMatch(
      /交集不超过|唯一一条 sequence/
    )

    // (i) Position FALLBACK clause — the position vocabulary (all four
    // quadrants), a confusable-trigger phrasing, and the two known confusable
    // pairs named via their shared/symbols.ts ids.
    for (const quadrant of ['左上', '右上', '左下', '右下']) {
      expect(rule, `${label}: position vocabulary must include ${quadrant}`).toContain(quadrant)
    }
    expect(
      rule,
      `${label}: must name a confusable trigger (易混 / 误描述 / 辨不下 / 相似)`
    ).toMatch(/易混|误描述|辨不下|相似/)
    expect(rule, `${label}: must name the trident half of the trident+psi pair`).toMatch(/trident/)
    expect(rule, `${label}: must name the psi half of the trident+psi pair`).toMatch(/psi/)
    expect(rule, `${label}: must name the hourglass half of the hourglass+delta pair`).toMatch(
      /hourglass/
    )
    expect(rule, `${label}: must name the delta half of the hourglass+delta pair`).toMatch(/delta/)
    // Symbol-default / position-fallback 主次: position is a 兜底, not primary.
    expect(rule, `${label}: must frame position as a 兜底 (fallback)`).toMatch(/兜底/)
    expect(
      rule,
      `${label}: position must be fallback, NOT the primary referent (不是默认主指代 / 才启用)`
    ).toMatch(/不是默认主指代|不是主指代|才启用|而非主指代/)
    // RED LINE (玩家可报性): position is a player-REPORTED visible layout fact,
    // mirroring wire's top-to-bottom legitimacy — not an AI-imagined screen.
    expect(
      rule,
      `${label}: position must read as a player-reported visible layout fact (亲眼可见 / 亲口报 / 报给你)`
    ).toMatch(/亲眼可见|亲口报|报给你/)

    // (ii) The stripped absolute "玩家不需要理解位置 / 序号" phrasing — which
    // fights the position fallback — must be GONE.
    expect(rule, `${label}: must NOT carry the stripped 不需要理解位置/序号 absolute`).not.toMatch(
      /不需要理解/
    )
  }

  it('practice.yaml keypad preamble carries the position-fallback hardening', () => {
    assertKeypadPositionFallback('practice.yaml', loadKeypadPreamble(PRACTICE_YAML))
  })

  it('every daily YAML keypad preamble carries the position-fallback hardening', () => {
    const dailyFiles = readdirSync(DAILY_DIR).filter((f) => f.endsWith('.yaml'))
    expect(dailyFiles.length).toBeGreaterThan(0)
    for (const file of dailyFiles) {
      assertKeypadPositionFallback(file, loadKeypadPreamble(join(DAILY_DIR, file)))
    }
  })

  it("today's daily keypad preamble equals practice's (regen propagated the edit)", () => {
    // The daily generator carries the keypad.rule string verbatim
    // (structuredClone) — only the sequence ROWS are permuted. So every daily's
    // keypad preamble must be character-equal to practice's. This catches a
    // stale daily that predates a practice preamble edit (regen not run /
    // partial) — the same 派生漏更 guard wire and button carry.
    const practiceRule = loadKeypadPreamble(PRACTICE_YAML)
    const dailyFiles = readdirSync(DAILY_DIR).filter((f) => f.endsWith('.yaml'))
    expect(dailyFiles.length).toBeGreaterThan(0)
    const offenders: string[] = []
    for (const file of dailyFiles) {
      const dailyRule = loadKeypadPreamble(join(DAILY_DIR, file))
      if (dailyRule !== practiceRule) offenders.push(file)
    }
    expect(
      offenders,
      `daily keypad preambles differ from practice (stale — rerun gen:daily):\n  ${offenders.join('\n  ')}`
    ).toEqual([])
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
