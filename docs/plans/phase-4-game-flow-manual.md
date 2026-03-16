# Phase 4: Game Flow + Manual System

> **Part of:** [BombSquad MVP Development](2026-03-12-bombsquad-mvp-development.md)
> **Prerequisites:** Phase 2 complete (rule engine for manual loading). Phase 3 NOT required for page shells — wiring modules into GamePage is the only Phase 3 dependency.
> **Delivers to:** Phase 5 (result page exists, game flow generates submission data)
> **Parallel with:** Phase 3 (page shells are independent; only GamePage wiring waits for Phase 3)

---

## Goal

Wire together the complete game experience: React Context state machine managing the LOADING → READY → PLAYING → ALL_COMPLETE → RESULT flow, a high-res timer, 4 real pages with full UI, the manual page system (YAML → anti-human HTML), and prompt templates for the landing page.

---

## Architecture

```
packages/game/src/
├── store/
│   └── game-context.tsx          ← React Context + useReducer state machine
├── hooks/
│   ├── useTimer.ts               ← performance.now() + requestAnimationFrame
│   ├── useGameSession.ts         ← orchestrates module sequence + error tracking
│   └── useDailyChallenge.ts      ← date-based manual URL + attempt counter
├── pages/
│   ├── HomePage.tsx              ← full implementation (replaces placeholder)
│   ├── GamePage.tsx              ← full implementation (replaces placeholder)
│   ├── ResultPage.tsx            ← full implementation (replaces placeholder)
│   └── LeaderboardPage.tsx       ← full implementation (placeholder data)
├── components/
│   ├── Timer.tsx
│   ├── ProgressBar.tsx
│   └── SceneInfoBar.tsx
└── utils/
    ├── yaml-loader.ts            ← fetch + parse YAML manual
    ├── clipboard.ts              ← copy-to-clipboard with fallback
    └── date.ts                   ← date helpers (today's YYYY-MM-DD, etc.)

packages/manual/
├── src/
│   ├── template.html             ← HTML template for manual pages
│   └── anti-human.css           ← intentionally unreadable YAML rendering
├── data/
│   ├── practice.yaml            ← (created in Phase 2)
│   └── daily/
│       └── 2026-03-16.yaml      ← first daily challenge manual
└── build.ts                     ← YAML → HTML static page generator

prompts/
├── standard-prompt.md
├── example-skills.md
└── review-template.md
```

---

## Tech Stack

Same as previous phases. Uses:
- `js-yaml` for YAML parsing (already installed)
- `performance.now()` + `requestAnimationFrame` for timer (built-in)
- `navigator.clipboard.writeText` + `document.execCommand('copy')` fallback

---

## Tasks

### Game state machine

- [ ] **Task 4.1** — Create `packages/game/src/store/game-context.tsx`:

  The state machine manages the overall game lifecycle. Puzzle-level logic (module retries, individual answers) lives in `useGameSession`.

  **State shape:**
  ```typescript
  type GameStatus =
    | 'LOADING'          // fetching + parsing manual
    | 'READY'            // manual loaded, waiting for player to start
    | 'PLAYING'          // active game
    | 'MODULE_COMPLETE'  // brief success state between modules
    | 'ALL_COMPLETE'     // all 4 modules done, computing result
    | 'RESULT'           // showing result page data

  interface GameState {
    status: GameStatus
    mode: 'practice' | 'daily' | null
    manual: Manual | null
    manualUrl: string | null
    sceneInfo: SceneInfo | null
    moduleConfigs: ModuleConfig[] | null
    moduleAnswers: ModuleAnswer[] | null
    currentModuleIndex: number
    moduleStats: ModuleStats[]   // time per module, reset count
    totalStartTime: number | null
    totalEndTime: number | null
    errorMessage: string | null
    attemptNumber: number
  }
  ```

  **Actions:**
  ```typescript
  type GameAction =
    | { type: 'START_LOADING'; mode: 'practice' | 'daily'; manualUrl: string }
    | { type: 'MANUAL_LOADED'; manual: Manual; sceneInfo: SceneInfo; configs: ModuleConfig[]; answers: ModuleAnswer[] }
    | { type: 'LOAD_ERROR'; message: string }
    | { type: 'START_GAME' }
    | { type: 'MODULE_COMPLETE'; moduleIndex: number; timeTaken: number; resetCount: number }
    | { type: 'NEXT_MODULE' }
    | { type: 'ALL_MODULES_COMPLETE' }
    | { type: 'RESET' }
  ```

  Export: `GameContext`, `useGame()` hook, `GameProvider` wrapper component.

- [ ] **Task 4.2** — Verify the state machine transitions are exhaustive and never leave the player in an undefined state (e.g., PLAYING with null moduleConfigs is invalid — throw in dev mode).

### Timer hook

- [ ] **Task 4.3** — Create `packages/game/src/hooks/useTimer.ts`:

  ```typescript
  import { useState, useEffect, useRef } from 'react'

  /**
   * High-resolution game timer.
   * Uses performance.now() for accuracy; updates display via requestAnimationFrame.
   * Never pauses — module errors don't stop the clock.
   */
  export function useTimer(running: boolean) {
    const [elapsedMs, setElapsedMs] = useState(0)
    const startTimeRef = useRef<number | null>(null)
    const rafRef = useRef<number | null>(null)

    useEffect(() => {
      if (!running) {
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
        return
      }

      startTimeRef.current = performance.now() - elapsedMs

      const tick = () => {
        setElapsedMs(performance.now() - startTimeRef.current!)
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)

      return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
    }, [running])

    /** Format as MM:SS */
    const display = formatTime(elapsedMs)

    return { elapsedMs, display }
  }

  function formatTime(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  ```

### Game session hook

- [ ] **Task 4.4** — Create `packages/game/src/hooks/useGameSession.ts`:

  Orchestrates the module sequence within a game. Handles per-module reset-and-regenerate on error.

  ```typescript
  /**
   * Manages per-module state within a single game session.
   * On error: regenerates the current module config (answer changes), resets counter.
   * Calls dispatch(MODULE_COMPLETE) when a module finishes.
   */
  export function useGameSession(
    manual: Manual | null,
    sceneInfo: SceneInfo | null,
    dispatch: Dispatch<GameAction>,
  ) {
    const moduleStartTimeRef = useRef<number | null>(null)
    const resetCountRef = useRef(0)

    const onModuleComplete = useCallback(() => {
      const timeTaken = performance.now() - (moduleStartTimeRef.current ?? performance.now())
      dispatch({
        type: 'MODULE_COMPLETE',
        moduleIndex: currentModuleIndex,
        timeTaken,
        resetCount: resetCountRef.current,
      })
      resetCountRef.current = 0
    }, [...])

    const onModuleError = useCallback(() => {
      resetCountRef.current++
      // Regenerate current module config
      // dispatch({ type: 'REGENERATE_MODULE', index: currentModuleIndex })
    }, [...])

    // ...
  }
  ```

### Daily challenge hook

- [ ] **Task 4.5** — Create `packages/game/src/hooks/useDailyChallenge.ts`:

  ```typescript
  /**
   * Returns the manual URL for today's daily challenge.
   * Also tracks attempt number per day in sessionStorage.
   */
  export function useDailyChallenge(): {
    practiceUrl: string
    dailyUrl: string
    attemptNumber: number
    incrementAttempt: () => void
  } {
    const today = getTodayString()   // YYYY-MM-DD from date.ts
    const dailyUrl = `https://bombsquad.amio.fans/manual/${today}`
    const practiceUrl = 'https://bombsquad.amio.fans/manual/practice'

    const key = `attempt-${today}`
    const [attemptNumber, setAttemptNumber] = useState(() =>
      parseInt(sessionStorage.getItem(key) ?? '0', 10)
    )

    const incrementAttempt = useCallback(() => {
      const next = attemptNumber + 1
      sessionStorage.setItem(key, String(next))
      setAttemptNumber(next)
    }, [attemptNumber, key])

    return { practiceUrl, dailyUrl, attemptNumber, incrementAttempt }
  }
  ```

### Utility helpers

- [ ] **Task 4.6** — Create `packages/game/src/utils/yaml-loader.ts`:

  ```typescript
  import yaml from 'js-yaml'
  import type { Manual } from '@shared/manual-schema'

  const CACHE = new Map<string, Manual>()

  export async function loadManual(url: string): Promise<Manual> {
    if (CACHE.has(url)) return CACHE.get(url)!

    const res = await fetch(url, {
      headers: { 'Accept': 'application/yaml, text/plain' },
    })
    if (!res.ok) throw new Error(`Failed to load manual: ${res.status} ${res.statusText}`)
    const text = await res.text()
    const manual = yaml.load(text) as Manual
    CACHE.set(url, manual)
    return manual
  }
  ```

- [ ] **Task 4.7** — Create `packages/game/src/utils/clipboard.ts`:

  ```typescript
  export async function copyToClipboard(text: string): Promise<boolean> {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text)
        return true
      } catch { /* fall through */ }
    }
    // Legacy fallback
    const el = document.createElement('textarea')
    el.value = text
    el.style.position = 'fixed'
    el.style.opacity = '0'
    document.body.appendChild(el)
    el.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(el)
    return ok
  }
  ```

- [ ] **Task 4.8** — Create `packages/game/src/utils/date.ts`:

  ```typescript
  export function getTodayString(): string {
    return new Date().toISOString().slice(0, 10)   // YYYY-MM-DD
  }
  ```

### Shared UI components

- [ ] **Task 4.9** — Create `packages/game/src/components/Timer.tsx`:

  ```typescript
  import styles from './Timer.module.css'

  interface TimerProps {
    display: string   // MM:SS from useTimer
    isRunning: boolean
  }

  export default function Timer({ display, isRunning }: TimerProps) {
    return (
      <div
        className={`${styles.timer} ${isRunning ? styles.running : ''}`}
        role="timer"
        aria-label={`Elapsed time: ${display}`}
      >
        {display}
      </div>
    )
  }
  ```

  Style: `font-family: var(--font-mono)`, large neon-cyan text, neon glow `text-shadow`.

- [ ] **Task 4.10** — Create `packages/game/src/components/ProgressBar.tsx`:

  ```typescript
  interface ProgressBarProps {
    total: number            // always 4 for MVP
    completed: number
    current: number          // index of active module (for "in progress" indicator)
  }

  export default function ProgressBar({ total, completed, current }: ProgressBarProps) {
    return (
      <div role="progressbar" aria-valuenow={completed} aria-valuemax={total}>
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={i < completed ? 'filled' : i === current ? 'active' : 'empty'}
            aria-label={`Module ${i + 1}: ${i < completed ? 'complete' : i === current ? 'in progress' : 'pending'}`}
          />
        ))}
      </div>
    )
  }
  ```

- [ ] **Task 4.11** — Create `packages/game/src/components/SceneInfoBar.tsx`:

  Displays serial number, battery count, indicator labels+status. All data the player must describe to the AI.

  ```typescript
  interface SceneInfoBarProps {
    sceneInfo: SceneInfo
  }

  export default function SceneInfoBar({ sceneInfo }: SceneInfoBarProps) {
    return (
      <div className={styles.bar} aria-label="Scene information panel">
        <span className={styles.field}>
          <span className={styles.label}>SN:</span>
          <span className={styles.value}>{sceneInfo.serialNumber}</span>
        </span>
        <span className={styles.field}>
          <span className={styles.label}>BATT:</span>
          <span className={styles.value}>{sceneInfo.batteryCount}</span>
        </span>
        {sceneInfo.indicators.map(ind => (
          <span key={ind.label} className={`${styles.indicator} ${ind.lit ? styles.lit : styles.unlit}`}>
            {ind.label}
          </span>
        ))}
      </div>
    )
  }
  ```

### Full page implementations

- [ ] **Task 4.12** — Implement full `packages/game/src/pages/HomePage.tsx`:

  **UI elements:**
  1. Title: "BOMBSQUAD" (glitch/flicker animation on H1)
  2. Two CTA buttons: "Practice" (secondary) and "Daily Challenge" (primary, neon-cyan border)
  3. "Leaderboard" link below buttons
  4. "How to Start" section: 4 numbered steps
  5. Prompt display box with today's prompt text (manual URL populated) + "Copy" button
  6. Supported AI tools footer text: "Works with Claude · ChatGPT · Gemini · any voice AI"

  **Behavior:**
  - Practice button: sets mode to `practice`, navigates to `/game?mode=practice`
  - Daily Challenge button: sets mode to `daily`, navigates to `/game?mode=daily`
  - Copy button: calls `copyToClipboard()`, shows "Copied!" feedback for 2s
  - Prompt text interpolates actual manual URL

- [ ] **Task 4.13** — Implement full `packages/game/src/pages/GamePage.tsx`:

  **URL param:** `?mode=practice|daily`

  **Layout:**
  - Top bar: Timer (left) + mode label + attempt number (right)
  - Center: active module component (`WireModule`, `DialModule`, `ButtonModule`, or `KeypadModule`)
  - Scene info bar: below module
  - Progress bar: very bottom

  **Lifecycle:**
  1. Mount → dispatch `START_LOADING` → `loadManual(url)` → dispatch `MANUAL_LOADED`
  2. Once READY: show "Ready? Start!" overlay, click starts timer
  3. PLAYING: render current module, pass `onComplete` / `onError` callbacks
  4. MODULE_COMPLETE: brief "DEFUSED" overlay (800ms), then `NEXT_MODULE`
  5. ALL_COMPLETE: navigate to `/result`

  **Error state:** If LOAD_ERROR → show retry button.

- [ ] **Task 4.14** — Implement full `packages/game/src/pages/ResultPage.tsx`:

  **Displays:**
  1. Success/failure header ("DEFUSED" or "EXPLODED")
  2. Total time in large monospace
  3. Attempt number ("Daily Challenge — Attempt #3")
  4. Module breakdown table: module name | time | reset count
  5. Today's best (from sessionStorage) vs this run
  6. Global rank placeholder ("Submit to see rank" → filled by Phase 5)
  7. Copy Summary button (generates plain-text summary, calls `copyToClipboard`)
  8. "Play Again" button (dominant CTA — neon-cyan, full-width-ish)
  9. Secondary links: "View Leaderboard" + "Home"

  **Plain-text summary format:**
  ```
  === BombSquad Result ===
  Date: {date}
  Mode: Daily Challenge (Attempt #{n})
  Result: Success ✓
  Total Time: 04:23

  Module Breakdown:
  1. Wire     — 01:12  (0 resets)
  2. Dial     — 01:45  (1 reset)
  3. Button   — 00:38  (0 resets)
  4. Keypad   — 00:48  (0 resets)

  Debrief prompt:
  The dial module took the longest with 1 reset. What went wrong and how can we improve our symbol communication?
  ```

- [ ] **Task 4.15** — Implement `packages/game/src/pages/LeaderboardPage.tsx`:

  Placeholder data for now (Phase 5 will wire real API). Shows a table with columns: Rank | Nickname | Time | Attempts | AI Tool. Hardcode 3–5 fake rows. Real fetch wired in Phase 5.

### Manual system

- [ ] **Task 4.16** — Create `packages/manual/` directory structure and `packages/manual/package.json`:

  ```json
  {
    "name": "manual",
    "private": true,
    "type": "module",
    "scripts": {
      "build": "tsx build.ts"
    },
    "devDependencies": {
      "tsx": "^4.0.0"
    },
    "dependencies": {
      "js-yaml": "^4.1.0"
    }
  }
  ```

- [ ] **Task 4.17** — Create `packages/manual/src/template.html`:

  ```html
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>BombSquad Manual</title>
    <link rel="stylesheet" href="anti-human.css" />
  </head>
  <body>
  <!-- HUMAN-READABLE SECTION -->
  <div class="human-notice">
    <h1>🤖 This manual is designed for AI</h1>
    <p>Humans cannot effectively read the following content.</p>
    <p>Please send this page's URL to your AI assistant and let it be your bomb-disposal expert.</p>
    <p>💡 Not sure how to start? <a href="https://bombsquad.amio.fans">Return to the game page</a> for instructions.</p>
  </div>
  <hr class="divider" />
  <p class="divider-label">↓ The following content is for AI use only ↓</p>

  <!-- ANTI-HUMAN YAML SECTION — rendered by build script -->
  <div class="anti-human">{{YAML_CONTENT}}</div>
  </body>
  </html>
  ```

- [ ] **Task 4.18** — Create `packages/manual/src/anti-human.css`:

  ```css
  /* Normal human-readable section */
  .human-notice {
    font-family: system-ui, sans-serif;
    font-size: 16px;
    color: #333;
    background: #f9f9f9;
    padding: 24px;
    max-width: 600px;
    margin: 0 auto;
    line-height: 1.6;
  }

  .human-notice h1 { font-size: 20px; margin-bottom: 12px; }
  .human-notice a { color: #0066cc; }
  .divider { margin: 16px auto; max-width: 600px; border-color: #ddd; }
  .divider-label { text-align: center; color: #999; font-size: 12px; }

  /* Anti-human section — intentional WCAG violation (design mechanic) */
  .anti-human {
    font-size: 4px;
    color: #888888;
    background-color: #999999;
    line-height: 1;
    word-break: break-all;
    white-space: nowrap;
    overflow: hidden;
    padding: 2px;
    user-select: none;
  }
  ```

- [ ] **Task 4.19** — Create `packages/manual/build.ts`:

  Reads all YAML files in `data/` and `data/daily/`, outputs HTML pages using the template. The YAML is serialized as a single-line string without indentation to maximize human unreadability.

  ```typescript
  import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs'
  import { resolve, join } from 'path'
  import yaml from 'js-yaml'

  const templatePath = resolve(__dirname, 'src/template.html')
  const template = readFileSync(templatePath, 'utf8')
  const outDir = resolve(__dirname, 'dist')
  mkdirSync(outDir, { recursive: true })

  function buildPage(yamlPath: string, outName: string) {
    const content = readFileSync(yamlPath, 'utf8')
    // Minify: remove newlines and extra spaces for anti-human rendering
    const minified = yaml.dump(yaml.load(content), {
      flowLevel: 0,
      lineWidth: -1,
    }).replace(/\n/g, ' ')

    const html = template.replace('{{YAML_CONTENT}}', minified)
    const outPath = join(outDir, outName)
    writeFileSync(outPath, html)
    console.log(`Built: ${outPath}`)
  }

  // Build practice
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
  } catch { /* daily/ may not exist yet */ }
  ```

- [ ] **Task 4.20** — Create `packages/manual/data/daily/2026-03-16.yaml`: First real daily challenge manual. Same structure as `practice.yaml` but with different rules and more complexity. Include 30+ real rules across 4 modules + 6 decoy modules totaling 200+ rules.

- [ ] **Task 4.21** — Create Cloudflare Pages content-negotiation function at `packages/manual/functions/manual/[date].ts`:

  ```typescript
  export async function onRequest(context: {
    request: Request
    params: { date: string }
    env: { ASSETS: Fetcher }
  }) {
    const { request, params, env } = context
    const url = new URL(request.url)
    const format = url.searchParams.get('format')
    const acceptHeader = request.headers.get('Accept') ?? ''

    const wantsYaml =
      format === 'yaml' ||
      format === 'text' ||
      acceptHeader.includes('application/yaml') ||
      acceptHeader.includes('text/plain')

    if (wantsYaml) {
      // Serve raw YAML file from assets
      const yamlUrl = new URL(request.url)
      yamlUrl.pathname = `/manual/data/${params.date}.yaml`
      const yamlResp = await env.ASSETS.fetch(yamlUrl.toString())
      return new Response(await yamlResp.text(), {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
        },
      })
    }

    // Serve HTML page for browser access
    return env.ASSETS.fetch(request)
  }
  ```

### Prompt templates

- [ ] **Task 4.22** — Create `prompts/standard-prompt.md`:

  ```markdown
  You are a bomb disposal expert. Your partner is facing a bomb and needs your guidance through reading the operations manual.

  The manual is here: {MANUAL_URL}

  Please read the complete manual first, then tell your partner you are ready.

  Game rules:
  - They will describe what they see using voice
  - You find the matching rules in the manual and tell them what to do
  - Shorter time = higher global leaderboard rank
  - They may attempt multiple times; each run generates a new puzzle but uses the same manual

  Important:
  1. They may describe imprecisely — ask follow-up questions about key details
  2. Some rules have exception conditions — check all conditions carefully
  3. Give concise instructions; avoid lengthy explanations
  4. If uncertain, ask them to confirm rather than guessing
  5. The manual contains many decoy rules (morse code, maze, etc.) — ignore modules they don't mention
  6. Always ask about the Scene Info bar values (serial number, battery count, indicator lights) — many rules depend on these
  ```

- [ ] **Task 4.23** — Create `prompts/example-skills.md`:

  ```markdown
  # BombSquad Bomb Disposal Strategy v1.0

  ## General Principles
  - Handle one module at a time, confirm completion before moving to the next
  - Collect all conditions before giving an instruction
  - Use "from the left, position X" for wire positions

  ## Symbol Description Convention
  We use these short names:
  - omega    = "horseshoe"
  - psi      = "fork"
  - delta    = "triangle"
  - star     = "star"
  - xi       = "three lines"
  - diamond  = "diamond"
  - trident  = "trident"
  - crescent = "crescent"
  If I describe something you don't recognize, repeat it back and confirm

  ## Opening Protocol
  At the start of each run, I will report:
  1. Serial number
  2. Battery count
  3. Indicator lights (label and whether lit)
  You record these — all modules may reference them

  ## My Weaknesses
  - I may call colors wrong under pressure — if a combination isn't in the manual, ask me to look again
  - For hold-button modules, give me 1 extra second of advance notice before "release"
  - I sometimes forget to mention stripe patterns on wires — always ask
  ```

- [ ] **Task 4.24** — Create `prompts/review-template.md`:

  ```markdown
  # BombSquad Post-Game Debrief

  Here are my results from the last run:

  {RESULT_SUMMARY}

  Please help me analyze:
  1. Which module took the longest and why?
  2. What communication patterns caused the most delays?
  3. What should I add or update in our skills file to improve next run?
  4. Suggest 2-3 specific phrasings I can practice to describe [slowest module] faster.
  ```

---

## Verification

```bash
# Tests still pass
pnpm test:run

# Dev server runs
pnpm dev

# Manual build works
cd packages/manual && pnpm build
# → dist/practice.html and dist/2026-03-16.html created
```

**Manual visual checklist:**
1. Navigate to `http://localhost:5173/` — home page renders with both CTAs
2. Click "Practice" → navigates to `/game?mode=practice` → manual loads → game starts
3. Complete all 4 modules → result page shows time + module breakdown
4. Click "Play Again" → returns to game with new puzzle (same manual)
5. Open `dist/practice.html` in browser:
   - Top section is readable, explains it's for AI
   - Bottom section is unreadable (4px, low contrast)

**Checklist:**
- [ ] All 4 pages fully implemented (no placeholder text)
- [ ] Timer starts exactly when player clicks "Start" and stops on last module complete
- [ ] Module sequence: Wire → Dial → Button → Keypad (fixed order)
- [ ] Module error: regenerates current module config, keeps timer running
- [ ] "Play Again" regenerates all 4 modules, reuses same manual
- [ ] Copy button on home page copies prompt with correct manual URL
- [ ] Copy summary button on result page copies plain text
- [ ] Manual HTML: top section readable, bottom section anti-human
- [ ] Cloudflare Pages Function: `Accept: application/yaml` returns raw YAML
- [ ] `prompts/` directory contains all 3 template files

---

## Key Files Created in This Phase

| File | Role |
|------|------|
| `packages/game/src/store/game-context.tsx` | Game state machine (Context + useReducer) |
| `packages/game/src/hooks/useTimer.ts` | High-res timer (RAF-based) |
| `packages/game/src/hooks/useGameSession.ts` | Module sequence + error/reset orchestration |
| `packages/game/src/hooks/useDailyChallenge.ts` | Date-based manual URL + attempt counter |
| `packages/game/src/pages/HomePage.tsx` | Full home page |
| `packages/game/src/pages/GamePage.tsx` | Full game page with state machine integration |
| `packages/game/src/pages/ResultPage.tsx` | Full result page with summary generation |
| `packages/game/src/pages/LeaderboardPage.tsx` | Leaderboard page (placeholder data) |
| `packages/game/src/components/Timer.tsx` | MM:SS timer display |
| `packages/game/src/components/ProgressBar.tsx` | Module completion progress |
| `packages/game/src/components/SceneInfoBar.tsx` | Scene info display |
| `packages/game/src/utils/yaml-loader.ts` | Fetch + parse YAML manual |
| `packages/game/src/utils/clipboard.ts` | Clipboard with legacy fallback |
| `packages/game/src/utils/date.ts` | Date helpers |
| `packages/manual/package.json` | Manual package config |
| `packages/manual/src/template.html` | Manual HTML template |
| `packages/manual/src/anti-human.css` | Anti-human rendering styles |
| `packages/manual/build.ts` | YAML → HTML build script |
| `packages/manual/data/daily/2026-03-16.yaml` | First daily challenge manual |
| `packages/manual/functions/manual/[date].ts` | Content negotiation Pages Function |
| `prompts/standard-prompt.md` | Standard AI prompt template |
| `prompts/example-skills.md` | Example skills file |
| `prompts/review-template.md` | Post-game debrief template |
