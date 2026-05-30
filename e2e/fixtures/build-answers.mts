/**
 * build-answers.mts — golden-fixture builder for the e2e harness.
 *
 * Runs the game's OWN seeded RNG + module generators against a pinned daily
 * timestamp `T` and the daily-manual fixture, and writes e2e/fixtures/answers.json
 * — the mechanical answer for every module of a deterministic daily and
 * practice run. The harness plays a real, full play-through using these
 * answers; it never re-implements a solver.
 *
 * Why import the generators directly: the answers stay derived from the same
 * code the app runs, so a generator change that would silently invalidate the
 * fixture is caught by re-running this script and diffing answers.json (the
 * Round-3 CI golden-fixture guard).
 *
 * `T` is chosen offline here by iterating candidate timestamps until the daily
 * `button` puzzle resolves to `action: 'tap'` — that lets the harness solve the
 * button module with a single click and no press-and-hold choreography.
 *
 * Run: `pnpm e2e:build-answers` (tsx). Imports cross only relative paths into
 * `packages/game-bombsquad/src`; every `@shared/*` import in that subtree is `import type`
 * (erased by esbuild), so no path-alias resolution is needed. `generateSceneInfo`
 * is the one piece inlined verbatim from `packages/game-bombsquad/src/engine/scene-info.ts`
 * (it is scene generation, not a solver) to keep this script alias-free; the
 * harness smoke check confirms the inlined copy stays in sync with runtime.
 */
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import yaml from 'js-yaml'

import { createRng, type Rng } from '../../packages/game-bombsquad/src/engine/rng.ts'
import { generateWire } from '../../packages/game-bombsquad/src/modules/wire/generator.ts'
import { generateDial } from '../../packages/game-bombsquad/src/modules/dial/generator.ts'
import { generateButton } from '../../packages/game-bombsquad/src/modules/button/generator.ts'
import { generateKeypad } from '../../packages/game-bombsquad/src/modules/keypad/generator.ts'
import { TONGUE_TWISTERS } from '../../packages/game-bombsquad/src/data/tongue-twisters.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))

// --- Manual types (structural; full schema is shared/manual-schema.ts) -------
interface SceneInfo {
  sceneTongueTwister: string
  batteryCount: number
  indicators: { label: string; lit: boolean }[]
}
type Manual = {
  modules: {
    wire_routing: { rules: unknown[] }
    symbol_dial: { columns: string[][]; rule: string }
    button: { rules: unknown[] }
    keypad: { sequences: string[][]; rule: string }
  }
}

// --- Verbatim copy of packages/game-bombsquad/src/engine/scene-info.ts -----------------
// Kept in sync by the harness smoke check (runtime puzzles must match
// answers.json). scene-info is scene generation, not a solver.
const INDICATOR_LABELS = ['FRK', 'CAR', 'NSA', 'MSA', 'SND', 'CLR', 'BOB', 'TRN']

function generateSceneInfo(rng: Rng): SceneInfo {
  const sceneTongueTwister = rng.pick(TONGUE_TWISTERS)
  const batteryCount = rng.intBetween(1, 4)
  const indicatorCount = rng.intBetween(0, 3)
  const indicators = rng
    .shuffle(INDICATOR_LABELS)
    .slice(0, indicatorCount)
    .map((label) => ({ label, lit: rng.float() < 0.5 }))
  return { sceneTongueTwister, batteryCount, indicators }
}

// --- Module sequences (verbatim from store/game-context.tsx MODULE_SEQUENCE) -
const DAILY_SEQUENCE = ['wire', 'dial', 'button', 'keypad'] as const
const PRACTICE_SEQUENCE = ['wire', 'keypad'] as const
type ModuleKind = (typeof DAILY_SEQUENCE)[number]

interface ModuleAnswerEntry {
  kind: ModuleKind
  answer: unknown
}

/** Generate one module's `{config, answer}` by kind, exactly as GamePage does. */
function generateByKind(kind: ModuleKind, rng: Rng, manual: Manual, scene: SceneInfo) {
  switch (kind) {
    case 'wire':
      return generateWire(rng, manual.modules.wire_routing.rules as never, scene)
    case 'dial':
      return generateDial(rng, manual.modules.symbol_dial as never, scene)
    case 'button':
      return generateButton(rng, manual.modules.button.rules as never, scene)
    case 'keypad':
      return generateKeypad(rng, manual.modules.keypad as never, scene)
  }
}

/** Replay GamePage's load effect for one run: scene then the module sequence. */
function buildRun(
  seq: readonly ModuleKind[],
  seed: number,
  manual: Manual
): { scene: SceneInfo; answers: ModuleAnswerEntry[] } {
  const rng = createRng(seed)
  const scene = generateSceneInfo(rng)
  const answers: ModuleAnswerEntry[] = []
  for (const kind of seq) {
    const { answer } = generateByKind(kind, rng, manual, scene)
    answers.push({ kind, answer })
  }
  return { scene, answers }
}

function main() {
  const manualPath = resolve(__dirname, 'daily-manual.yaml')
  const manual = yaml.load(readFileSync(manualPath, 'utf8')) as Manual

  // Practice seed is the constant PRACTICE_SEED = 42 (utils/session.ts).
  const PRACTICE_SEED = 42
  const practice = buildRun(PRACTICE_SEQUENCE, PRACTICE_SEED, manual)

  // Pick a daily timestamp T whose button puzzle resolves to action:'tap'.
  // Base: 2026-05-22T12:00:00Z, then step forward 1 ms at a time.
  const BASE_T = Date.UTC(2026, 4, 22, 12, 0, 0)
  let chosenT = -1
  let daily: { scene: SceneInfo; answers: ModuleAnswerEntry[] } | null = null
  for (let i = 0; i < 200_000; i++) {
    const candidate = BASE_T + i
    try {
      const run = buildRun(DAILY_SEQUENCE, candidate, manual)
      const button = run.answers.find((a) => a.kind === 'button')
      if ((button?.answer as { action?: string })?.action === 'tap') {
        chosenT = candidate
        daily = run
        break
      }
    } catch {
      // Generator exhaustion on this candidate — skip it.
    }
  }
  if (chosenT < 0 || daily === null) {
    throw new Error('build-answers: no daily timestamp produced a tap-button puzzle')
  }

  const out = {
    // Pinned daily run-seed. getRunSeed('daily') returns Date.now(); the
    // harness freezes the clock at this value before /bombsquad/run mounts.
    seed: chosenT,
    note: 'Generated by e2e/fixtures/build-answers.mts — do not hand-edit.',
    tonguePool: [...TONGUE_TWISTERS],
    daily: { scene: daily.scene, answers: daily.answers },
    practice: { scene: practice.scene, answers: practice.answers },
  }

  const outPath = resolve(__dirname, 'answers.json')
  writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`, 'utf8')
  console.log(`build-answers: wrote ${outPath}`)
  console.log(`  daily seed T = ${chosenT}`)
  console.log(`  daily answers  = ${JSON.stringify(daily.answers)}`)
  console.log(`  practice answers = ${JSON.stringify(practice.answers)}`)
}

main()
