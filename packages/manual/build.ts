import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs'
import { resolve, join, dirname } from 'path'
import { fileURLToPath } from 'url'
import yaml from 'js-yaml'

const __dirname = dirname(fileURLToPath(import.meta.url))

const templatePath = resolve(__dirname, 'src/template.html')
const template = readFileSync(templatePath, 'utf8')
const outDir = resolve(__dirname, 'dist')
mkdirSync(outDir, { recursive: true })

function buildPage(yamlPath: string, outName: string) {
  const content = readFileSync(yamlPath, 'utf8')
  // Minify YAML: collapse to a single line for anti-human rendering
  const minified = yaml.dump(yaml.load(content), {
    flowLevel: 5,
    lineWidth: -1,
  }).replace(/\n/g, ' ').trim()

  const html = template.replace('{{YAML_CONTENT}}', minified)
  const outPath = join(outDir, outName)
  writeFileSync(outPath, html)
  console.log(`Built: ${outPath}`)
}

// Build practice manual
buildPage(
  resolve(__dirname, 'data/practice.yaml'),
  'practice.html',
)

// Build daily manuals
const dailyDir = resolve(__dirname, 'data/daily')
try {
  for (const file of readdirSync(dailyDir)) {
    if (file.endsWith('.yaml')) {
      buildPage(join(dailyDir, file), file.replace('.yaml', '.html'))
    }
  }
} catch {
  // data/daily/ may not exist yet — that is fine
}
