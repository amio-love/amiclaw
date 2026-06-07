#!/usr/bin/env node
/**
 * Regression assertion runner for the fix-bombsquad-deep-link-refresh-blank fix.
 *
 * Pure data assertions over the source SPA-fallback config:
 *   - packages/platform/public/_redirects (the BombSquad sub-app fallback rules)
 *
 * The bug had two failure modes, both fixed by the final two-rule shape:
 *
 *   1. Deep-route blank shell. The original fallback proxied to
 *      /bombsquad/index.html. Cloudflare Pages auto-redirects an index-file
 *      request to its extension-less directory form (/bombsquad/index.html ->
 *      308 -> /bombsquad/), so the rewrite produced a redirect instead of
 *      serving the SPA and the follow-up request fell through to the
 *      platform-shell catch-all — every hard-load / refresh of
 *      /bombsquad/connect, /bombsquad/run, /bombsquad/result rendered a blank
 *      shell. Targeting the directory /bombsquad/ fixes this.
 *
 *   2. Shadowed assets. A broad /bombsquad/* 200 rewrite is evaluated before
 *      the real file and wins even when a file exists, so it shadows the real
 *      /bombsquad/assets/* bundle, serving the SPA index HTML (text/html) in
 *      place of the JS/CSS — breaking the whole bundle. An explicit
 *      /bombsquad/assets/* pass-through, ordered BEFORE the broad fallback,
 *      protects the real assets.
 *
 * This script guards the corrected two-rule shape so a future edit cannot
 * silently (a) revert the deep-route target to /bombsquad/index.html, (b) drop
 * the asset pass-through, or (c) misorder the rules.
 *
 * Companion scenarios live in
 * e2e/regression/fix-bombsquad-deep-link-refresh-blank.gherkin. This script is
 * the executable surface — the gherkin is documentation. Exits 0 on full pass,
 * non-zero on any failure with every failed scenario named in stderr.
 *
 * Usage:
 *   node e2e/regression/fix-bombsquad-deep-link-refresh-blank.assert.mjs
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '../..')

const REDIRECTS = resolve(REPO_ROOT, 'packages/platform/public/_redirects')

const failures = []
function record(scenarioName, message) {
  failures.push(`  ✗ ${scenarioName}\n      ${message}`)
}

/**
 * Parse the _redirects file into ordered [source, destination, code] rules,
 * ignoring blank lines and `#` comments. Status code is optional in the file
 * format (defaults to 302) but every rule we assert on declares it explicitly.
 */
function loadRules() {
  const text = readFileSync(REDIRECTS, 'utf8')
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => {
      const [source, destination, code] = line.split(/\s+/)
      return { source, destination, code }
    })
}

// ---------- Scenario A: asset pass-through protects real bundle files ----------
function scenarioA() {
  const name = 'BombSquad asset pass-through (/bombsquad/assets/*) protects real bundle files'
  const rules = loadRules()
  const rule = rules.find((r) => r.source === '/bombsquad/assets/*')
  if (!rule) {
    record(
      name,
      'no "/bombsquad/assets/*" pass-through rule found — a broad /bombsquad/* 200 rewrite would shadow the real JS/CSS bundle and serve index HTML in its place'
    )
    return
  }
  // The destination must route the asset request back to a real asset path
  // (a self pass-through), not the SPA index/directory.
  if (!rule.destination.startsWith('/bombsquad/assets/')) {
    record(
      name,
      `asset rule destination is "${rule.destination}" (expected a /bombsquad/assets/ pass-through such as "/bombsquad/assets/:splat")`
    )
  }
  if (rule.code !== '200') {
    record(name, `asset pass-through status is "${rule.code}" (expected "200")`)
  }
}

// ---------- Scenario B: asset rule precedes the broad /bombsquad/* fallback ----------
function scenarioB() {
  const name = 'Asset pass-through is ordered before the broad /bombsquad/* fallback'
  const rules = loadRules()
  const assetIdx = rules.findIndex((r) => r.source === '/bombsquad/assets/*')
  const broadIdx = rules.findIndex((r) => r.source === '/bombsquad/*')
  if (assetIdx === -1) {
    record(name, 'no "/bombsquad/assets/*" rule found')
    return
  }
  if (broadIdx === -1) {
    record(name, 'no broad "/bombsquad/*" rule found')
    return
  }
  // Cloudflare Pages applies the first matching rule. The broad /bombsquad/*
  // also matches /bombsquad/assets/..., so the specific asset rule MUST come
  // first or the broad fallback shadows the real assets.
  if (assetIdx > broadIdx) {
    record(
      name,
      `"/bombsquad/assets/*" (index ${assetIdx}) appears after "/bombsquad/*" (index ${broadIdx}); the broad fallback would shadow the assets`
    )
  }
}

// ---------- Scenario C: broad fallback targets the directory, not index.html ----------
function scenarioC() {
  const name =
    'BombSquad deep-route fallback proxies to /bombsquad/ (directory), not /bombsquad/index.html'
  const rules = loadRules()
  const rule = rules.find((r) => r.source === '/bombsquad/*')
  if (!rule) {
    record(name, 'no rule found with source "/bombsquad/*" in _redirects')
    return
  }
  // The load-bearing negative: must NOT revert to the index-file target that
  // triggers Cloudflare Pages' /index.html -> directory 308 canonicalization.
  if (rule.destination === '/bombsquad/index.html') {
    record(
      name,
      'fallback target is the pre-fix value "/bombsquad/index.html" — this 308-bounces to /bombsquad/ and drops to the platform shell'
    )
    return
  }
  if (rule.destination !== '/bombsquad/') {
    record(name, `fallback target is "${rule.destination}" (expected the directory "/bombsquad/")`)
  }
  if (rule.code !== '200') {
    record(
      name,
      `fallback status is "${rule.code}" (expected a "200" proxy rewrite, not a redirect)`
    )
  }
}

// ---------- Scenario D: the fallback precedes the platform-shell catch-all ----------
function scenarioD() {
  const name = 'BombSquad fallback is ordered before the /* platform-shell catch-all'
  const rules = loadRules()
  const bombsquadIdx = rules.findIndex((r) => r.source === '/bombsquad/*')
  const catchAllIdx = rules.findIndex((r) => r.source === '/*')
  if (bombsquadIdx === -1) {
    record(name, 'no "/bombsquad/*" rule found')
    return
  }
  if (catchAllIdx === -1) {
    record(name, 'no "/*" catch-all rule found')
    return
  }
  // Cloudflare Pages applies the first matching rule, so the more specific
  // /bombsquad/* prefix must come first or the catch-all swallows it.
  if (bombsquadIdx > catchAllIdx) {
    record(
      name,
      `"/bombsquad/*" (index ${bombsquadIdx}) appears after "/*" (index ${catchAllIdx}); the catch-all would win`
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
  '== fix-bombsquad-deep-link-refresh-blank regression run ==\n' +
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
