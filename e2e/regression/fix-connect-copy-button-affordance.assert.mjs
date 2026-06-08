#!/usr/bin/env node
/**
 * Regression assertion runner for fix-connect-copy-button-affordance.
 *
 * Cheap static source-read backstop over
 *   packages/game-bombsquad/src/pages/ConnectPage.tsx
 * guarding against re-introducing either copy affordance failure:
 * a dead (disabled) bottom CTA on step 1, or a visible manual URL card that no
 * longer shares the copy/fallback action.
 *
 * The AUTHORITATIVE executable guard is the React Testing Library unit test in
 * the same package (ConnectPage.test.tsx) — this script is only a no-browser
 * source backstop, matching the gherkin documentation in
 * e2e/regression/fix-connect-copy-button-affordance.gherkin. Exits 0 on full
 * pass, non-zero on any failure with every failed scenario named in stderr.
 *
 * Usage:
 *   node e2e/regression/fix-connect-copy-button-affordance.assert.mjs
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '../..')
const CONNECT_PAGE = resolve(REPO_ROOT, 'packages/game-bombsquad/src/pages/ConnectPage.tsx')

const failures = []
function record(scenarioName, message) {
  failures.push(`  ✗ ${scenarioName}\n      ${message}`)
}

const src = readFileSync(CONNECT_PAGE, 'utf8')

/* Extract the step-1 branch of the bottom CTA — the JSX between `step === 1 ?`
   and the `) : (` that opens the step-2 branch inside the `.cta` container. We
   anchor on the `.cta` wrapper to avoid matching the step-1 content block. */
function ctaStep1Branch() {
  const ctaIdx = src.indexOf('className={styles.cta}')
  if (ctaIdx === -1) return null
  const rest = src.slice(ctaIdx)
  // The first `) : (` after the cta wrapper closes the step-1 branch.
  const branchMatch = rest.match(/step === 1 \?([\s\S]*?)\)\s*:\s*\(/)
  return branchMatch ? branchMatch[1] : null
}

// ---------- Scenario 1: step-1 primary CTA is the copy action, not dead ----------
function scenarioCta() {
  const name = 'step-1 primary CTA is the copy action, not a dead control'
  const branch = ctaStep1Branch()
  if (branch === null) {
    record(name, 'could not locate the step-1 branch of the bottom CTA in ConnectPage.tsx')
    return
  }
  // The step-1 primary CTA must NOT carry a `disabled` prop. Strip block
  // comments first so the word "disabled" inside an explanatory comment does
  // not trip the guard — only a real JSX `disabled` attribute should.
  const branchNoComments = branch.replace(/\/\*[\s\S]*?\*\//g, '')
  if (/\bdisabled(\s*=|[\s/>])/.test(branchNoComments)) {
    record(
      name,
      'step-1 primary CTA still carries a `disabled` prop — the dead-control affordance inversion is back'
    )
  }
  // The CTA must be wired to the copy handler.
  if (!/onClick=\{handleCopy\}/.test(branch)) {
    record(name, 'step-1 primary CTA is not wired to handleCopy (onClick={handleCopy} missing)')
  }
  // The label must be the copy action「复制手册」(and the copied state「已复制」).
  if (!/复制手册/.test(branch)) {
    record(name, 'step-1 primary CTA label「复制手册」not found')
  }
  if (!/已复制/.test(branch)) {
    record(name, 'step-1 primary CTA copied-state label「已复制」not found')
  }
}

// ---------- Scenario 2: URL card shares the copy action ----------
function scenarioPreview() {
  const name = 'the URL card is also a copy target sharing the same handler'
  const cardMatch = src.match(
    /<button[\s\S]*?className=\{`\$\{styles\.urlPreview\}[\s\S]*?<\/button>/
  )
  if (!cardMatch) {
    record(name, 'styles.urlPreview is not rendered on a <button> in ConnectPage.tsx')
    return
  }
  const card = cardMatch[0]
  if (!/onClick=\{handleCopy\}/.test(card)) {
    record(name, 'the manual URL card is not wired to handleCopy')
  }
  if (!/复制手册链接/.test(card)) {
    record(name, 'the manual URL card copy aria-label is missing')
  }
  if (/\bdisabled(\s*=|[\s/>])/.test(card.replace(/\/\*[\s\S]*?\*\//g, ''))) {
    record(name, 'the manual URL card is disabled on step 1')
  }
  // The legacy clickable copyCard class must be gone.
  if (/styles\.copyCard\b/.test(src)) {
    record(
      name,
      'the legacy clickable styles.copyCard is still referenced (should be styles.urlPreview)'
    )
  }
  // The manual URL must still be rendered (trust requirement).
  if (!/\{manualUrl\}/.test(src)) {
    record(name, 'the manual URL ({manualUrl}) is no longer rendered on step 1 (trust requirement)')
  }
}

// ---------- Scenario 3: /compatibility link stays reachable ----------
function scenarioCompatLink() {
  const name = 'the /compatibility discovery link stays reachable from step 1'
  if (!/to="\/bombsquad\/compatibility"/.test(src)) {
    record(name, 'the /bombsquad/compatibility discovery link is missing from ConnectPage.tsx')
  }
}

// ---------- Driver ----------
const scenarios = [
  ['cta', scenarioCta],
  ['preview', scenarioPreview],
  ['compat-link', scenarioCompatLink],
]

process.stdout.write(
  '== fix-connect-copy-button-affordance regression run ==\n' +
    `Repo root: ${REPO_ROOT}\n` +
    `Scenarios: ${scenarios.length}\n\n`
)

for (const [, fn] of scenarios) {
  fn()
}

if (failures.length === 0) {
  process.stdout.write(`✓ all ${scenarios.length} scenarios passed\n`)
  process.exit(0)
}

process.stderr.write(`✗ ${failures.length} failure(s):\n`)
for (const f of failures) {
  process.stderr.write(`${f}\n`)
}
process.exit(1)
