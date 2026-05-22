#!/usr/bin/env node
/**
 * Coverage reconciliation audit — verifies that the e2e/flow-inventory.yaml SSOT
 * and the journey Gherkin scenarios stay in a strict scenario <-> flow 1:1
 * bijection.
 *
 * Implements §Mechanism 3 of the e2e governance spec
 * (docs/architecture/arch-component-e2e-governance.md).
 *
 * Usage:
 *   node e2e/scripts/audit-coverage.mjs
 *   pnpm e2e:audit
 *
 * The audit reads e2e/flow-inventory.yaml and every top-level e2e/*.gherkin
 * journey file (e2e/regression/ is excluded — regression scenarios trace to
 * fixed bugs, not flows, so they are not part of the bijection). It pairs each
 * journey scenario to the nearest preceding `# Source: <flow-id>` comment and
 * emits five reconciliation signals:
 *
 *   - gap         : a status:active flow that no journey scenario claims
 *   - orphan      : a scenario # Source: pointing to a missing / deprecated flow
 *   - duplicate   : a flow id claimed by >=2 scenarios (breaks the 1:1 bijection)
 *   - untagged    : a journey scenario with no # Source: comment at all
 *   - missing-tag : a journey scenario with no @playwright / @simulation tag
 *
 * Exits non-zero (1) if any signal fires; exits 0 with a success summary when
 * the bijection is clean. Exits 2 if the audit itself cannot run.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import { Parser, AstBuilder, GherkinClassicTokenMatcher } from '@cucumber/gherkin'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '../..')
const E2E_DIR = resolve(REPO_ROOT, 'e2e')
const INVENTORY_PATH = resolve(E2E_DIR, 'flow-inventory.yaml')

// A per-scenario flow-source comment: `# Source: <flow-id>` (leading whitespace
// is trimmed before matching, so the in-file indentation does not matter).
const SOURCE_COMMENT = /^#\s*Source:\s*(\S+)\s*$/
// Every journey scenario must declare exactly which consumption layer runs it.
const CONSUMPTION_TAGS = new Set(['@playwright', '@simulation'])

// ---------- Inventory ----------
/**
 * Parse e2e/flow-inventory.yaml into an active-flow map and a deprecated-id set.
 * Only `status: active` flows participate in the bijection; `status: deprecated`
 * ids are tracked separately so a scenario claiming one can be reported as an
 * orphan with a precise reason.
 */
function loadInventory() {
  const doc = yaml.load(readFileSync(INVENTORY_PATH, 'utf8'))
  const flows = doc?.flows
  if (!Array.isArray(flows)) {
    throw new Error(`flow-inventory.yaml has no 'flows' list: ${INVENTORY_PATH}`)
  }
  const active = new Map()
  const deprecated = new Set()
  for (const flow of flows) {
    if (!flow || typeof flow.id !== 'string') continue
    if (flow.status === 'active') active.set(flow.id, flow)
    else if (flow.status === 'deprecated') deprecated.add(flow.id)
  }
  return { active, deprecated }
}

// ---------- Gherkin parsing ----------
let idCounter = 0
const newId = () => String(idCounter++)

/**
 * List the top-level journey Gherkin files. e2e/regression/ is a subdirectory,
 * so a non-recursive readdir naturally excludes it from the journey set.
 */
function listJourneyFiles() {
  return readdirSync(E2E_DIR)
    .filter((name) => name.endsWith('.gherkin'))
    .sort()
    .map((name) => join(E2E_DIR, name))
}

function parseGherkin(path) {
  const parser = new Parser(new AstBuilder(newId), new GherkinClassicTokenMatcher())
  return parser.parse(readFileSync(path, 'utf8'))
}

/**
 * Flatten a feature's children into a line-ordered scenario list. Rules are
 * descended into defensively — the current spec files use none, but a future
 * Rule: block must not silently hide scenarios from the audit.
 */
function collectScenarios(feature) {
  const out = []
  const walk = (children) => {
    for (const child of children ?? []) {
      if (child.scenario) out.push(child.scenario)
      else if (child.rule) walk(child.rule.children)
    }
  }
  walk(feature?.children)
  return out.sort((a, b) => a.location.line - b.location.line)
}

/**
 * Extract all `# Source: <flow-id>` comments from a parsed document, ordered by
 * line. Non-source comments (file headers, inline notes) are dropped.
 */
function sourceComments(doc) {
  return (doc.comments ?? [])
    .map((comment) => ({
      line: comment.location.line,
      match: comment.text.trim().match(SOURCE_COMMENT),
    }))
    .filter((entry) => entry.match !== null)
    .map((entry) => ({ line: entry.line, flowId: entry.match[1] }))
    .sort((a, b) => a.line - b.line)
}

/**
 * Resolve the flow id a scenario claims: the nearest `# Source:` comment that
 * sits strictly between the previous scenario and this one. Constraining the
 * lower bound to the previous scenario's line is what makes a scenario whose
 * own # Source: comment was removed surface as `untagged` rather than silently
 * inheriting its predecessor's claim.
 */
function claimedFlowId(scenario, prevLine, comments) {
  const candidates = comments.filter(
    (comment) => comment.line > prevLine && comment.line < scenario.location.line
  )
  return candidates.length > 0 ? candidates[candidates.length - 1].flowId : null
}

/**
 * Scan every journey file into a flat list of scenario records, each carrying
 * its claimed flow id (or null) and whether it declares a consumption-layer tag.
 */
function scanJourneyScenarios() {
  const records = []
  for (const path of listJourneyFiles()) {
    const rel = relative(REPO_ROOT, path)
    const doc = parseGherkin(path)
    if (!doc.feature) continue
    const comments = sourceComments(doc)
    let prevLine = 0
    for (const scenario of collectScenarios(doc.feature)) {
      const tags = (scenario.tags ?? []).map((tag) => tag.name)
      records.push({
        file: rel,
        line: scenario.location.line,
        name: scenario.name,
        flowId: claimedFlowId(scenario, prevLine, comments),
        hasConsumptionTag: tags.some((name) => CONSUMPTION_TAGS.has(name)),
        tags,
      })
      prevLine = scenario.location.line
    }
  }
  return records
}

// ---------- Audit ----------
function auditCoverage() {
  const { active, deprecated } = loadInventory()
  const scenarios = scanJourneyScenarios()

  const flowToScenarios = new Map()
  const orphans = []
  const untagged = []
  const missingTag = []

  for (const scenario of scenarios) {
    if (!scenario.hasConsumptionTag) missingTag.push(scenario)

    if (scenario.flowId === null) {
      untagged.push(scenario)
      continue
    }
    if (!active.has(scenario.flowId)) {
      const reason = deprecated.has(scenario.flowId)
        ? 'flow is status:deprecated'
        : 'flow id not found in inventory'
      orphans.push({ scenario, reason })
      continue
    }
    if (!flowToScenarios.has(scenario.flowId)) flowToScenarios.set(scenario.flowId, [])
    flowToScenarios.get(scenario.flowId).push(scenario)
  }

  const gaps = []
  for (const [id, flow] of active) {
    if (!flowToScenarios.has(id)) gaps.push(flow)
  }

  const duplicates = []
  for (const [id, claimingScenarios] of flowToScenarios) {
    if (claimingScenarios.length >= 2) {
      duplicates.push({ flowId: id, scenarios: claimingScenarios })
    }
  }

  return { active, scenarios, gaps, orphans, duplicates, untagged, missingTag }
}

// ---------- Report ----------
function fmtScenario(scenario) {
  return `${scenario.file}:${scenario.line}  "${scenario.name}"`
}

function report(result) {
  const { active, scenarios, gaps, orphans, duplicates, untagged, missingTag } = result
  const lines = []
  lines.push('BombSquad e2e coverage reconciliation audit')
  lines.push('===========================================')
  lines.push(`Inventory:         ${relative(REPO_ROOT, INVENTORY_PATH)}`)
  lines.push(`Active flows:      ${active.size}`)
  lines.push(`Journey scenarios: ${scenarios.length}`)
  lines.push('')
  lines.push('Signals:')
  lines.push(`  gap          ${gaps.length}`)
  lines.push(`  orphan       ${orphans.length}`)
  lines.push(`  duplicate    ${duplicates.length}`)
  lines.push(`  untagged     ${untagged.length}`)
  lines.push(`  missing-tag  ${missingTag.length}`)
  lines.push('')

  const clean =
    gaps.length === 0 &&
    orphans.length === 0 &&
    duplicates.length === 0 &&
    untagged.length === 0 &&
    missingTag.length === 0

  if (clean) {
    lines.push(
      `✓ Coverage is a clean ${active.size} <-> ${scenarios.length} bijection — every status:active flow is claimed by exactly one tagged journey scenario.`
    )
    process.stdout.write(`${lines.join('\n')}\n`)
    return 0
  }

  if (gaps.length > 0) {
    lines.push(`✗ gap (${gaps.length}) — active flow with zero claiming scenarios:`)
    for (const flow of gaps) lines.push(`    - ${flow.id}  (${flow.name ?? 'unnamed'})`)
    lines.push('')
  }
  if (orphans.length > 0) {
    lines.push(`✗ orphan (${orphans.length}) — scenario # Source: points to an invalid flow:`)
    for (const orphan of orphans) {
      lines.push(`    - ${fmtScenario(orphan.scenario)}`)
      lines.push(`        claims '${orphan.scenario.flowId}' — ${orphan.reason}`)
    }
    lines.push('')
  }
  if (duplicates.length > 0) {
    lines.push(`✗ duplicate (${duplicates.length}) — flow id claimed by >=2 scenarios:`)
    for (const duplicate of duplicates) {
      lines.push(`    - ${duplicate.flowId} claimed by ${duplicate.scenarios.length} scenarios:`)
      for (const scenario of duplicate.scenarios) lines.push(`        ${fmtScenario(scenario)}`)
    }
    lines.push('')
  }
  if (untagged.length > 0) {
    lines.push(`✗ untagged (${untagged.length}) — journey scenario with no # Source: comment:`)
    for (const scenario of untagged) lines.push(`    - ${fmtScenario(scenario)}`)
    lines.push('')
  }
  if (missingTag.length > 0) {
    lines.push(
      `✗ missing-tag (${missingTag.length}) — journey scenario with no @playwright / @simulation tag:`
    )
    for (const scenario of missingTag) {
      const tags = scenario.tags.length > 0 ? scenario.tags.join(' ') : '(none)'
      lines.push(`    - ${fmtScenario(scenario)}  tags: ${tags}`)
    }
    lines.push('')
  }
  lines.push(
    'Audit failed — the scenario <-> flow bijection is broken. Resolve every signal above (see docs/architecture/arch-component-e2e-governance.md §Mechanism 3).'
  )
  process.stdout.write(`${lines.join('\n')}\n`)
  return 1
}

// ---------- Main ----------
function main() {
  let result
  try {
    result = auditCoverage()
  } catch (error) {
    process.stderr.write(`Coverage audit could not run: ${error.message}\n`)
    process.exit(2)
  }
  process.exit(report(result))
}

main()
