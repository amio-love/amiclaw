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

  // Build the injected variant: a deep-clone of `parsed` augmented with a
  // `symbols` block derived from SYMBOLS. Only this variant is embedded in
  // the rendered HTML; the source yaml and the dist raw yaml never carry
  // descriptions (Option C: hybrid HTML-only inline).
  const referenced = collectReferencedSymbolIds(parsed.modules)
  const injected = structuredClone(parsed)
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

  // Dist raw yaml: serialise the un-injected `parsed` object (no symbols
  // block) so the `?format=yaml` AI path and any downstream consumer of
  // the raw asset stays consistent with the source-yaml shape.
  writeFileSync(join(dataOutDir, `${slug}.yaml`), yaml.dump(parsed))
  console.log(`Built manual route: /manual/${slug}`)
}

// Build practice manual
buildPage(resolve(__dirname, 'data/practice.yaml'), 'practice')

// Build daily manuals
const dailyDir = resolve(__dirname, 'data/daily')
try {
  for (const file of readdirSync(dailyDir)) {
    if (file.endsWith('.yaml')) {
      buildPage(join(dailyDir, file), basename(file, '.yaml'))
    }
  }
} catch {
  // data/daily/ may not exist yet — that is fine
}
