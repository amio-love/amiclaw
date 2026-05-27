import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { resolve, join, dirname, basename } from 'path'
import { fileURLToPath } from 'url'
import yaml from 'js-yaml'
// On Node 25 + tsx, `shared/*.ts` files load as CJS-via-default because
// `shared/` has no `package.json` with `"type": "module"` to opt into
// native ESM. The named exports therefore live under the default import
// rather than at the namespace top level. Pulling SYMBOLS through the
// default import is the most localised workaround — no scope creep into
// the shared package, and we still rely on the SYMBOLS SSOT (no inlined
// description copy).
import sharedSymbolsModule from '../../shared/symbols.ts'
const { SYMBOLS } = sharedSymbolsModule
import { validateNoSourceAiInstructions, validateNoSourceSymbols } from './validators.ts'

/**
 * Local copy of the Manual / validator types to avoid the ESM+CJS interop
 * trap when tsx loads `shared/manual-schema.ts` from a `"type": "module"`
 * package on Node 25. The shapes are intentionally minimal — only what the
 * build-time validator needs. The full schema lives in
 * `shared/manual-schema.ts`; the `manual-schema.test.ts` suite in the game
 * package exercises the real `validateManualSymbols` against shipped YAMLs.
 *
 * NOTE: `shared/symbols.ts` is a leaf module (no imports of its own) and
 * imports cleanly via tsx, which is why we pull SYMBOLS directly above
 * instead of inlining a copy.
 */
interface MinimalModules {
  symbol_dial?: { columns?: string[][] }
  keypad?: { sequences?: string[][] }
}
interface MinimalManual {
  meta?: { version?: string }
  modules: MinimalModules
  symbols?: Record<string, { description?: string }>
  ai_instructions?: Record<string, string[]>
}

/**
 * Hard output constraints for the AI partner, injected at build time into
 * every rendered manual (practice + every daily). The manual is the only
 * surface the AI is actually given — players never read it — so the rules
 * governing what the AI may say to the player belong here, as data the AI
 * reads before any puzzle rule.
 *
 * Injected (like `symbols`) rather than authored into each source yaml:
 * one SSOT covers all 360+ committed daily files plus every future one,
 * and survives the daily generator's wholesale `meta` rewrite.
 */
const AI_INSTRUCTIONS: Record<string, string[]> = {
  do_not_reveal_to_player: [
    'The player never sees this manual and acts only on what you say aloud. Never read out, paste, quote, or summarize raw manual content to the player: rule text, condition tables, YAML or data structure, rule ids, or rule counts. Convert every lookup into one concrete action the player performs right now, e.g. "cut the second wire from the top".',
    'Never reveal or hint at the decoy modules (morse_code, maze, memory), and never tell the player that decoy or irrelevant rules exist. Only ever discuss the module the player is currently describing.',
    'Never expose manual meta-information or structure: how the manual is organized, how many rules it holds, or that most rules do not apply. Tell the player only the next action to perform.',
  ],
  give_conclusions_not_reasoning: [
    'When you look up a table, match conditions, or work out which rule applies, never narrate that process aloud. Do not tell the player which rule matched, which conditions you checked, or how you searched the manual.',
    'Reply with only the final, conclusive, executable instruction, e.g. "Cut the second wire from the top." Add a release or stop condition only when the action needs one, e.g. "hold the button and release when the strip turns red." Never say why.',
  ],
  game_context: [
    'Every fetch of this manual URL starts a fresh game. You have no memory of any previous session, and you must not assume any prior context about this player, this bomb, or any earlier conversation. Treat every player as new and every defusal as the first one.',
    'You are the bomb-defusal manual expert. The player never sees this manual; the entire document exists only for you. Your job is to translate every rule you read into a single concrete action the player can perform right now.',
    "The player is the defuser standing in front of the bomb. They can see the bomb's wires, buttons, displays, and symbols, but they cannot look anything up. Their entire knowledge of what to do comes from what you say aloud.",
    'Your only channel to the player is voice. There is no text chat, no diagrams, and no shared screen. Phrase every instruction so it is unambiguous when spoken aloud and easy to act on without re-asking.',
  ],
  collaboration_philosophy: [
    'When the player describes a symbol or feature and your visual vocabulary does not match, ask them to describe the shape in their own words — strokes, curves, comparisons to everyday objects — rather than asking them to pick from a list of dictionary names. Trust their description over your assumption.',
    'When you are not confident which rule applies, say so before guessing. Tell the player what you are uncertain about and ask one targeted clarifying question. Confidence about the wrong rule causes detonations; admitted uncertainty does not.',
    'This manual is intentionally incomplete by design, and your imperfect collaboration with the player is a feature, not a bug. After the session ends, the BombSquad app renders a recap summary that the player may choose to share with you outside the game; that app-rendered recap is the only legitimate source of information about prior play. Never claim to remember a previous session, and never act as if you can hear or recall any voice conversation that happened before this fetch.',
  ],
}

function collectReferencedSymbolIds(modules: MinimalModules): Set<string> {
  const referenced = new Set<string>()
  for (const col of modules.symbol_dial?.columns ?? []) {
    for (const s of col) referenced.add(s)
  }
  for (const seq of modules.keypad?.sequences ?? []) {
    for (const s of seq) referenced.add(s)
  }
  return referenced
}

/**
 * Verify every symbol id referenced by `modules` is registered in the
 * shared SYMBOLS SSOT. The descriptions themselves are NOT carried by the
 * source yaml under Option C — they are injected from SYMBOLS at build
 * time and embedded only in the rendered HTML.
 */
function validateReferencedSymbolsAgainstSSOT(manual: MinimalManual): void {
  const referenced = collectReferencedSymbolIds(manual.modules)
  const registered = new Set(SYMBOLS.map((s) => s.id))
  const missing: string[] = []
  for (const id of referenced) {
    if (!registered.has(id)) missing.push(id)
  }
  if (missing.length > 0) {
    throw new Error(
      `Manual ${manual.meta?.version ?? '<unknown>'}: symbol id(s) referenced in modules but not registered in shared/symbols.ts SYMBOLS: ${missing.join(', ')}`
    )
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url))

const templatePath = resolve(__dirname, 'src/template.html')
const template = readFileSync(templatePath, 'utf8')
const outDir = resolve(__dirname, 'dist')
const cssPath = resolve(__dirname, 'src/anti-human.css')
const dataOutDir = join(outDir, 'data')

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
mkdirSync(dataOutDir, { recursive: true })
copyFileSync(cssPath, join(outDir, 'anti-human.css'))

function buildPage(yamlPath: string, slug: string) {
  const content = readFileSync(yamlPath, 'utf8')
  const parsed = yaml.load(content) as MinimalManual

  // Fail loud if any symbol referenced in modules is not in the shared
  // SYMBOLS registry. Caught here before anything ships.
  validateReferencedSymbolsAgainstSSOT(parsed)

  // Fail loud if a source YAML carries its own `ai_instructions:` block —
  // AI_INSTRUCTIONS is owned here and injected; a source-level copy would
  // silently fight this constant if the merge order below ever regressed.
  validateNoSourceAiInstructions(parsed)

  // Fail loud if a source YAML carries its own `symbols:` block — symbol
  // descriptions live only in SYMBOLS SSOT and are HTML-only at injection;
  // a source-level copy would leak descriptions to the dist raw yaml path
  // (Option C invariant).
  validateNoSourceSymbols(parsed)

  // Prepend the AI output constraints so they render before any rule
  // content. This variant feeds both the HTML page and the dist raw yaml,
  // so the constraints reach the AI on every read path (browser HTML and
  // `?format=yaml`). Spread order places `ai_instructions` LAST so the
  // hard-coded AI_INSTRUCTIONS wins regardless of what `parsed` contains —
  // defense in depth alongside `validateNoSourceAiInstructions`.
  const withInstructions: MinimalManual = { ...parsed, ai_instructions: AI_INSTRUCTIONS }

  // Build the injected variant: a deep-clone of `withInstructions`
  // augmented with a `symbols` block derived from SYMBOLS. Only this
  // variant is embedded in the rendered HTML; the source yaml and the dist
  // raw yaml never carry descriptions (Option C: hybrid HTML-only inline).
  const referenced = collectReferencedSymbolIds(parsed.modules)
  const injected = structuredClone(withInstructions)
  injected.symbols = Object.fromEntries(
    [...referenced].map((id) => {
      const sym = SYMBOLS.find((s) => s.id === id)
      if (!sym) {
        // Unreachable — validateReferencedSymbolsAgainstSSOT ran above.
        throw new Error(`Symbol id "${id}" referenced but not in SYMBOLS`)
      }
      return [id, { description: sym.description }]
    })
  )

  // Minify YAML: emit fully-flow (JSON-like) on a single line for
  // anti-human rendering. `flowLevel: 0` forces flow style at every
  // depth, producing one dense `{...}` blob that is both visually
  // anti-human and round-trippable through `yaml.load` — required for
  // the cross-SSOT test that re-parses the HTML-embedded yaml.
  const minified = yaml
    .dump(injected, {
      flowLevel: 0,
      lineWidth: -1,
    })
    .trim()

  const html = template.replace('{{YAML_CONTENT}}', minified)
  const pageDir = join(outDir, slug)
  mkdirSync(pageDir, { recursive: true })
  writeFileSync(join(pageDir, 'index.html'), html)

  // Dist raw yaml: serialise `withInstructions` — carries the AI output
  // constraints (so the `?format=yaml` AI path is also governed) but never
  // the `symbols` block (Option C: descriptions stay HTML-only).
  writeFileSync(join(dataOutDir, `${slug}.yaml`), yaml.dump(withInstructions))
  console.log(`Built manual route: /manual/${slug}`)
}

// Build practice manual
buildPage(resolve(__dirname, 'data/practice.yaml'), 'practice')

// Build daily manuals. Narrow the try/catch to ONLY `readdirSync` and ONLY
// the ENOENT case (the directory has not been created yet — fine, no daily
// manuals to build). Any other readdir error (EACCES, EIO, …) and any error
// thrown from inside `buildPage` (validator throws, yaml parse errors, fs
// write failures, etc.) MUST propagate so the build exits non-zero — a
// broad swallow here would let a malformed daily yaml silently drop its
// route from `dist/` while the build still reports success.
const dailyDir = resolve(__dirname, 'data/daily')
let dailyFiles: string[] = []
try {
  dailyFiles = readdirSync(dailyDir).filter((f) => f.endsWith('.yaml'))
} catch (err) {
  // Only "directory does not exist yet" is acceptable here; surface every
  // other read error (permissions, IO, …) so it fails the build loudly.
  if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err
  // data/daily/ may not exist yet — that is fine
}
for (const file of dailyFiles) {
  buildPage(join(dailyDir, file), basename(file, '.yaml'))
}
