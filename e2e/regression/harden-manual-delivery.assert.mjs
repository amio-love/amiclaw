#!/usr/bin/env node
/**
 * Regression assertion runner for the harden-manual-delivery bundle.
 *
 * Guards the two manual-delivery robustness fixes:
 *   - Bug #2 (empty-308): a bare `/manual/<date>` (no trailing slash) HTML
 *     request must return a 200 body, NOT an empty 308 redirect. A weak
 *     external AI fetcher that does not follow redirects must still get the
 *     manual page in one hop. Asserted at the Pages Function level by
 *     invoking `functions/manual/[date].ts`'s `onRequest` with a mocked
 *     `env.ASSETS` that reproduces Cloudflare's directory-path 308 behaviour.
 *   - Bug #3 (re-fetch): AI_INSTRUCTIONS must carry a
 *     `retain_manual_in_session` key telling the AI to read the manual once
 *     and keep it in working memory rather than re-fetching the link every
 *     turn. Observed through the built dist raw YAML (the AI's `?format=yaml`
 *     payload).
 *
 * Companion scenarios live in e2e/regression/harden-manual-delivery.gherkin.
 * This script is the executable surface — the gherkin is documentation.
 * Exits 0 on full pass, non-zero on any failure with every failed scenario
 * named in stderr.
 *
 * Bisect contract: on the pre-fix HEAD this script FAILS — the HTML path
 * returns the empty 308 unchanged and AI_INSTRUCTIONS has no
 * `retain_manual_in_session` key. After the fix it PASSES.
 *
 * Usage:
 *   node e2e/regression/harden-manual-delivery.assert.mjs
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { register } from 'tsx/esm/api'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '../..')

const require = createRequire(import.meta.url)
const yaml = require(
  require.resolve('js-yaml', {
    paths: [resolve(REPO_ROOT, 'packages/manual')],
  })
)

const FN_PATH = resolve(REPO_ROOT, 'functions/manual/[date].ts')
const DIST_PRACTICE_RAW = resolve(REPO_ROOT, 'packages/manual/dist/data/practice.yaml')

const failures = []
function record(scenarioName, message) {
  failures.push(`  ✗ ${scenarioName}\n      ${message}`)
}

/**
 * Build the manual so the dist raw YAML reflects the current AI_INSTRUCTIONS,
 * then load the AI-served payload. Mirrors the AI's `?format=yaml` fetch path.
 */
function loadDistAiInstructions() {
  execFileSync('pnpm', ['--filter', 'manual', 'build'], {
    cwd: REPO_ROOT,
    stdio: 'pipe',
  })
  const payload = yaml.load(readFileSync(DIST_PRACTICE_RAW, 'utf8'))
  return payload?.ai_instructions ?? {}
}

/**
 * Import the Pages Function under test. tsx's programmatic loader lets a plain
 * `node script.mjs` import the TypeScript source directly — no separate build
 * step for the function.
 */
async function loadOnRequest() {
  const unregister = register()
  try {
    const mod = await import(pathToFileURL(FN_PATH).href)
    return mod.onRequest
  } finally {
    await unregister()
  }
}

const HTML_BODY = '<!doctype html><html><body><pre class="anti-human">{blob}</pre></body></html>'

/**
 * Mock `env.ASSETS` that mirrors the REAL Cloudflare Pages edge behaviour for
 * the bomb manual route, verified against a `wrangler pages dev` preview:
 *   - a bare directory path `/manual/<date>` (no trailing slash) → empty 308
 *     redirect to the canonical `/manual/<date>/` (the weak-fetcher trap)
 *   - the explicit index asset `/manual/<date>/index.html` ALSO → empty 308 to
 *     the same `/manual/<date>/` directory URL. This is the crucial detail the
 *     earlier mock got wrong: on the real edge `/index.html` does NOT serve a
 *     200, it redirects to the directory form. A mock that 200s `/index.html`
 *     hides the bug, which is why the fix must follow ASSETS' OWN redirect
 *     rather than guessing the `/index.html` path.
 *   - only the canonical trailing-slash directory form `/manual/<date>/` → 200
 *     with the anti-human HTML body.
 */
function makeAssetsMock() {
  return {
    fetch: async (req) => {
      const u = new URL(req.url)
      const p = u.pathname
      // Only the canonical trailing-slash directory URL serves a 200 body.
      if (p.endsWith('/')) {
        return new Response(HTML_BODY, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      }
      // Both the bare directory path and an explicit `/index.html` 308-redirect
      // to the canonical trailing-slash directory URL — exactly as the real
      // Cloudflare Pages ASSETS binding does.
      const target = p.endsWith('/index.html') ? p.slice(0, -'index.html'.length) : `${p}/`
      return new Response('', {
        status: 308,
        headers: { Location: target },
      })
    },
  }
}

// ---------- Scenario A: bare /manual/<date> HTML path returns 200 body ----------
async function scenarioA() {
  const name = 'Bug #2 — bare /manual/<date> HTML path returns a 200 body, not an empty 308'
  let onRequest
  try {
    onRequest = await loadOnRequest()
  } catch (err) {
    record(name, `could not import functions/manual/[date].ts: ${err?.message ?? err}`)
    return
  }
  if (typeof onRequest !== 'function') {
    record(name, 'functions/manual/[date].ts does not export an onRequest function')
    return
  }

  const date = '2026-06-04'
  const request = new Request(`https://claw.amio.fans/manual/${date}`)
  let res
  try {
    res = await onRequest({ request, params: { date }, env: { ASSETS: makeAssetsMock() } })
  } catch (err) {
    record(name, `onRequest threw on a bare HTML request: ${err?.message ?? err}`)
    return
  }

  if (res.status !== 200) {
    record(
      name,
      `bare /manual/${date} returned status ${res.status} (expected 200; an empty 308 is the weak-fetcher trap this fix removes)`
    )
  }
  if (res.status >= 300 && res.status < 400) {
    record(
      name,
      `bare /manual/${date} is still a ${res.status} redirect — weak fetchers see no body`
    )
  }
  const body = await res.text()
  if (body.length === 0) {
    record(
      name,
      `bare /manual/${date} returned an EMPTY body — a non-redirect-following AI fetcher gets nothing`
    )
  }
  if (!/anti-human/.test(body)) {
    record(
      name,
      'bare /manual/<date> body is not the anti-human HTML page (fix must still serve the anti-human render)'
    )
  }
  const ct = res.headers.get('Content-Type') ?? ''
  if (!/text\/html/.test(ct)) {
    record(name, `bare /manual/<date> Content-Type is "${ct}" (expected text/html)`)
  }
}

// ---------- Scenario B: trailing-slash path still served untouched (no regression) ----------
async function scenarioB() {
  const name = 'Bug #2 guard — trailing-slash /manual/<date>/ still serves 200 (no regression)'
  let onRequest
  try {
    onRequest = await loadOnRequest()
  } catch (err) {
    record(name, `could not import functions/manual/[date].ts: ${err?.message ?? err}`)
    return
  }

  const date = '2026-06-04'
  const request = new Request(`https://claw.amio.fans/manual/${date}/`)
  let res
  try {
    res = await onRequest({ request, params: { date }, env: { ASSETS: makeAssetsMock() } })
  } catch (err) {
    record(name, `onRequest threw on a trailing-slash request: ${err?.message ?? err}`)
    return
  }
  if (res.status !== 200) {
    record(name, `trailing-slash /manual/${date}/ returned status ${res.status} (expected 200)`)
  }
  const body = await res.text()
  if (body.length === 0) {
    record(name, `trailing-slash /manual/${date}/ returned an empty body`)
  }
}

// ---------- Scenario C: content negotiation (?format=yaml) unchanged ----------
async function scenarioC() {
  const name = 'Bug #2 guard — ?format=yaml content negotiation path is unchanged'
  let onRequest
  try {
    onRequest = await loadOnRequest()
  } catch (err) {
    record(name, `could not import functions/manual/[date].ts: ${err?.message ?? err}`)
    return
  }

  const date = '2026-06-04'
  const yamlBody = 'ai_instructions:\n  game_overview:\n    - blah\n'
  const assets = {
    fetch: async (req) => {
      const u = new URL(req.url)
      if (u.pathname === `/manual/data/${date}.yaml`) {
        return new Response(yamlBody, { status: 200 })
      }
      return new Response('', { status: 404 })
    },
  }
  const request = new Request(`https://claw.amio.fans/manual/${date}?format=yaml`)
  let res
  try {
    res = await onRequest({ request, params: { date }, env: { ASSETS: assets } })
  } catch (err) {
    record(name, `onRequest threw on a ?format=yaml request: ${err?.message ?? err}`)
    return
  }
  if (res.status !== 200) {
    record(name, `?format=yaml returned status ${res.status} (expected 200)`)
  }
  const ct = res.headers.get('Content-Type') ?? ''
  if (!/text\/plain/.test(ct)) {
    record(
      name,
      `?format=yaml Content-Type is "${ct}" (expected text/plain — content negotiation must be unchanged)`
    )
  }
  const body = await res.text()
  if (body !== yamlBody) {
    record(
      name,
      '?format=yaml body differs from the served raw YAML (content negotiation regressed)'
    )
  }
}

// ---------- Scenario D: retain_manual_in_session AI instruction ----------
function scenarioD() {
  const name = 'Bug #3 — AI_INSTRUCTIONS carries a retain_manual_in_session instruction'
  let instructions
  try {
    instructions = loadDistAiInstructions()
  } catch (err) {
    record(name, `could not build / load dist AI_INSTRUCTIONS: ${err?.message ?? err}`)
    return
  }
  const retain = instructions.retain_manual_in_session
  if (!Array.isArray(retain) || retain.length === 0) {
    record(
      name,
      `ai_instructions.retain_manual_in_session is missing or empty (got: ${JSON.stringify(retain)})`
    )
    return
  }
  const text = retain.join('\n')
  // Each entry >= 30 chars and carries a CJK character (matches the global
  // AI_INSTRUCTIONS contract guarded in data-validation.test.ts).
  const CJK = /[一-鿿]/
  for (let i = 0; i < retain.length; i++) {
    const entry = retain[i]
    if (typeof entry !== 'string' || entry.length < 30) {
      record(
        name,
        `retain_manual_in_session[${i}] must be a string of at least 30 chars (got ${entry?.length})`
      )
    }
    if (typeof entry === 'string' && !CJK.test(entry)) {
      record(name, `retain_manual_in_session[${i}] must be Chinese (carry a CJK character)`)
    }
  }
  // (a) keep the manual in working memory for the whole session.
  if (!/记在|记住/.test(text)) {
    record(
      name,
      'retain_manual_in_session does not tell the AI to keep the manual in memory (记在 / 记住)'
    )
  }
  if (!/整局|整段对话/.test(text)) {
    record(
      name,
      'retain_manual_in_session does not scope retention to the whole session (整局 / 整段对话)'
    )
  }
  // (b) never re-open / re-fetch the unchanging manual link every turn.
  if (!/重新打开|重新抓取|重抓/.test(text)) {
    record(
      name,
      'retain_manual_in_session does not forbid re-fetching the link every turn (重新打开 / 重新抓取 / 重抓)'
    )
  }
}

// ---------- Driver ----------
const scenarios = [
  ['A', scenarioA],
  ['B', scenarioB],
  ['C', scenarioC],
  ['D', scenarioD],
]

process.stdout.write(
  '== harden-manual-delivery regression run ==\n' +
    `Repo root: ${REPO_ROOT}\n` +
    `Scenarios: ${scenarios.length}\n\n`
)

for (const [, fn] of scenarios) {
  await fn()
}

if (failures.length === 0) {
  process.stdout.write('✓ all 4 scenarios passed\n')
  process.exit(0)
}

process.stderr.write(`✗ ${failures.length} failure(s):\n`)
for (const f of failures) {
  process.stderr.write(`${f}\n`)
}
process.exit(1)
