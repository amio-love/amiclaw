import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { resolve, join, dirname, basename } from 'path'
import { fileURLToPath } from 'url'
import yaml from 'js-yaml'

/**
 * Local copy of the Manual / validator types to avoid the ESM+CJS interop
 * trap when tsx loads `shared/manual-schema.ts` from a `"type": "module"`
 * package on Node 25. The shapes are intentionally minimal — only what the
 * build-time validator needs. The full schema lives in
 * `shared/manual-schema.ts`; the `manual-schema.test.ts` suite in the game
 * package exercises the real `validateManualSymbols` against shipped YAMLs.
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

function validateManualSymbolsLocal(manual: MinimalManual): void {
  const referenced = new Set<string>()
  for (const col of manual.modules.symbol_dial?.columns ?? []) {
    for (const s of col) referenced.add(s)
  }
  for (const seq of manual.modules.keypad?.sequences ?? []) {
    for (const s of seq) referenced.add(s)
  }
  const declared = new Set(Object.keys(manual.symbols ?? {}))
  const missing: string[] = []
  for (const id of referenced) {
    const entry = manual.symbols?.[id]
    if (!entry || typeof entry.description !== 'string' || entry.description.trim() === '') {
      missing.push(id)
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Manual ${manual.meta?.version ?? '<unknown>'}: missing symbols.<id>.description for: ${missing.join(', ')}`
    )
  }
  const stale: string[] = []
  for (const id of declared) {
    if (!referenced.has(id)) stale.push(id)
  }
  if (stale.length > 0) {
    throw new Error(
      `Manual ${manual.meta?.version ?? '<unknown>'}: symbols block declares unused entries: ${stale.join(', ')}`
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

  // Fail loud if any symbol referenced in modules has no description in the
  // `symbols` block (or vice versa). Caught here before anything ships.
  validateManualSymbolsLocal(parsed)

  // Minify YAML: collapse to a single line for anti-human rendering
  const minified = yaml
    .dump(parsed, {
      flowLevel: 5,
      lineWidth: -1,
    })
    .replace(/\n/g, ' ')
    .trim()

  const html = template.replace('{{YAML_CONTENT}}', minified)
  const pageDir = join(outDir, slug)
  mkdirSync(pageDir, { recursive: true })
  writeFileSync(join(pageDir, 'index.html'), html)
  writeFileSync(join(dataOutDir, `${slug}.yaml`), content)
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
