import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { resolve, join, dirname, basename } from 'path'
import { fileURLToPath } from 'url'
import yaml from 'js-yaml'

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
  // Minify YAML: collapse to a single line for anti-human rendering
  const minified = yaml.dump(yaml.load(content), {
    flowLevel: 5,
    lineWidth: -1,
  }).replace(/\n/g, ' ').trim()

  const html = template.replace('{{YAML_CONTENT}}', minified)
  const pageDir = join(outDir, slug)
  mkdirSync(pageDir, { recursive: true })
  writeFileSync(join(pageDir, 'index.html'), html)
  writeFileSync(join(dataOutDir, `${slug}.yaml`), content)
  console.log(`Built manual route: /manual/${slug}`)
}

// Build practice manual
buildPage(
  resolve(__dirname, 'data/practice.yaml'),
  'practice',
)

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
