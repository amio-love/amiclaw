# Split BombSquad MVP Plan into Per-Phase Plans

> Historical note: this planning file predates implementation. The repository now contains working code and should not be treated as a statement of current repo status.

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the monolithic 6-phase BombSquad MVP development plan into 6 independent plan files + a master index, each detailed enough for agentic execution.

**Architecture:** Refactor `docs/plans/2026-03-12-bombsquad-mvp-development.md` into a lightweight master index linking to 6 phase plan files. Phase 0 (doc updates) merges into Phase 1 since it's trivially small.

**Key Decision:** Each phase plan follows the superpowers plan format (Goal, Architecture, Tech Stack, bite-sized tasks with TDD, verification checklist). Plans reference exact file paths, include code snippets, and specify run/verify commands.

---

## File Structure

```
docs/plans/
├── 2026-03-12-bombsquad-mvp-development.md  # Refactored into master index
├── phase-1-project-foundation.md
├── phase-2-rule-engine-generators.md
├── phase-3-puzzle-module-ui.md
├── phase-4-game-flow-manual.md
├── phase-5-leaderboard-backend.md
└── phase-6-polish-testing-deploy.md
```

---

## Task 1: Write Phase 1 — Project Foundation

- [ ] **Step 1:** Create `docs/plans/phase-1-project-foundation.md`

**Content outline:**
- **Goal:** Set up monorepo infrastructure and all foundational code that every subsequent phase depends on
- **Prerequisites:** None (greenfield)
- **Includes Phase 0 doc updates** as first task (fix domain references in `docs/AmiClaw_GameDesign.md` and `docs/AmiClaw_MVP.md`)

**Tasks to include:**
1. Doc updates — replace `bombsquad.amio` → `bombsquad.amio.fans` in both design docs
2. Init pnpm workspace root — `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`
3. Init `packages/game/` — Vite + React + TypeScript scaffold
4. Install dependencies — react, react-dom, react-router-dom, vite, @vitejs/plugin-react, typescript, js-yaml, vitest
5. Configure path aliases — `@shared/*` → `shared/`, `@/` → `packages/game/src/`
6. Set up React Router v6 — 4 routes (Home `/`, Game `/game`, Result `/result`, Leaderboard `/leaderboard`) with placeholder pages
7. Create CSS design tokens — `packages/game/src/styles/global.css` with all `--color-*` custom properties from DesignSystem.md
8. Implement seeded PRNG — `packages/game/src/engine/rng.ts` (mulberry32 algorithm, ~15 LOC, exports `intBetween`, `pick`, `shuffle`, `float`)
9. Write PRNG tests — verify determinism with seed 42, distribution sanity checks
10. Define shared TypeScript types — `shared/manual-schema.ts` (YAML manual structure), `shared/symbols.ts` (symbol pool type)
11. Create SVG symbol pool — `shared/symbols.ts` with 16 abstract symbols (id, name, description, SVG path data)
12. Verify: `pnpm dev` starts, routes render placeholders, `pnpm test` passes PRNG tests

**Reference docs:**
- `docs/DesignSystem.md` — color palette, typography, CSS approach
- `docs/plans/2026-03-12-bombsquad-mvp-development.md` Phase 1 section — dependency list, PRNG spec

**Key files to create:**
| File | Role |
|------|------|
| `package.json` | Workspace root |
| `pnpm-workspace.yaml` | Workspace config |
| `tsconfig.base.json` | Shared TS config with path aliases |
| `packages/game/package.json` | Game SPA package |
| `packages/game/vite.config.ts` | Vite config |
| `packages/game/tsconfig.json` | Extends base, adds aliases |
| `packages/game/index.html` | Entry HTML |
| `packages/game/src/main.tsx` | React entry |
| `packages/game/src/App.tsx` | Router setup |
| `packages/game/src/pages/HomePage.tsx` | Placeholder |
| `packages/game/src/pages/GamePage.tsx` | Placeholder |
| `packages/game/src/pages/ResultPage.tsx` | Placeholder |
| `packages/game/src/pages/LeaderboardPage.tsx` | Placeholder |
| `packages/game/src/styles/global.css` | Design tokens + reset |
| `packages/game/src/engine/rng.ts` | Seeded PRNG |
| `packages/game/src/engine/rng.test.ts` | PRNG tests |
| `shared/manual-schema.ts` | YAML manual types |
| `shared/symbols.ts` | SVG symbol pool |

- [ ] **Step 2:** Commit

---

## Task 2: Write Phase 2 — Rule Engine + Puzzle Generators

- [ ] **Step 1:** Create `docs/plans/phase-2-rule-engine-generators.md`

**Content outline:**
- **Goal:** Build the core game logic — rule engine that parses YAML manuals and condition matcher, plus all 4 puzzle generators/solvers with unit tests
- **Prerequisites:** Phase 1 complete (PRNG, shared types, Vitest configured)

**Tasks to include:**
1. Define module config types — `ModuleConfig`, `WireConfig`, `DialConfig`, `ButtonConfig`, `KeypadConfig` in `shared/manual-schema.ts`
2. Define module answer types — `ModuleAnswer`, `WireAnswer`, `DialAnswer`, `ButtonAnswer`, `KeypadAnswer`
3. Define scene info types — `SceneInfo` (serialNumber, batteryCount, indicators)
4. Implement condition matcher — `packages/game/src/engine/rule-engine.ts` with `matchCondition(condition, moduleConfig, sceneInfo): boolean`
   - Operators: equality, `gt`/`gte`/`lt`/`lte`, `odd`/`even`, counting (`count_*`), presence, position
5. Test condition matcher — every operator type with known inputs/expected outputs
6. Implement wire solver — `packages/game/src/modules/wire/solver.ts` with `solveWire(config, rules, sceneInfo): WireAnswer`
7. Implement wire generator — `packages/game/src/modules/wire/generator.ts` with validation loop (generate config → solve → verify unique answer → regenerate if ambiguous)
8. Test wire solver + generator — known configs with expected answers, 100 random generations all produce valid configs
9. Repeat for dial solver/generator — `modules/dial/solver.ts`, `modules/dial/generator.ts`
10. Repeat for button solver/generator — `modules/button/solver.ts`, `modules/button/generator.ts`
11. Repeat for keypad solver/generator — `modules/keypad/solver.ts`, `modules/keypad/generator.ts`
12. Implement answer validator — `packages/game/src/engine/answer-validator.ts`
13. Write practice manual YAML — `packages/manual/data/practice.yaml` (~30 real rules + 20 decoy rules)
14. Integration test — load practice YAML → generate all 4 modules → solve all → verify answers
15. Verify: `pnpm test` passes all unit + integration tests

**Reference docs:**
- `docs/AmiClaw_GameDesign.md` §3 — YAML manual structure, rule format examples
- `docs/AmiClaw_MVP.md` §3-4 — manual design, puzzle generation logic, answer validation
- `docs/plans/2026-03-12-bombsquad-mvp-development.md` Phase 2 — module constraints table, testing requirements

**Key files to create/modify:**
| File | Role |
|------|------|
| `shared/manual-schema.ts` | Add module config/answer types |
| `packages/game/src/engine/rule-engine.ts` | Condition matcher |
| `packages/game/src/engine/rule-engine.test.ts` | Condition matcher tests |
| `packages/game/src/engine/answer-validator.ts` | Validate player answers |
| `packages/game/src/modules/wire/types.ts` | Wire module types |
| `packages/game/src/modules/wire/solver.ts` | Wire solver |
| `packages/game/src/modules/wire/generator.ts` | Wire generator |
| `packages/game/src/modules/wire/solver.test.ts` | Wire tests |
| `packages/game/src/modules/dial/types.ts` | Dial module types |
| `packages/game/src/modules/dial/solver.ts` | Dial solver |
| `packages/game/src/modules/dial/generator.ts` | Dial generator |
| `packages/game/src/modules/dial/solver.test.ts` | Dial tests |
| `packages/game/src/modules/button/types.ts` | Button module types |
| `packages/game/src/modules/button/solver.ts` | Button solver |
| `packages/game/src/modules/button/generator.ts` | Button generator |
| `packages/game/src/modules/button/solver.test.ts` | Button tests |
| `packages/game/src/modules/keypad/types.ts` | Keypad module types |
| `packages/game/src/modules/keypad/solver.ts` | Keypad solver |
| `packages/game/src/modules/keypad/generator.ts` | Keypad generator |
| `packages/game/src/modules/keypad/solver.test.ts` | Keypad tests |
| `packages/manual/data/practice.yaml` | Practice manual |

- [ ] **Step 2:** Commit

---

## Task 3: Write Phase 3 — Puzzle Module UI

- [ ] **Step 1:** Create `docs/plans/phase-3-puzzle-module-ui.md`

**Content outline:**
- **Goal:** Build 4 interactive SVG-based React puzzle components with animations
- **Prerequisites:** Phase 2 complete (generators, solvers, shared types)
- **Internal structure:** Shared setup first, then 4 independent module sections (Wire → Dial → Button → Keypad)

**Tasks to include:**

*Shared setup:*
1. Define `ModuleProps` interface — `{ config, answer, onComplete, onError, sceneInfo }`
2. Create shared CSS animations — success (green flash, 800ms), error (red flash, screen shake, `navigator.vibrate(200)`), module crossfade transition
3. Wrap animations in `prefers-reduced-motion` media query

*Module A — Wire Routing:*
4. `WireModule.tsx` — 4-5 colored wires as SVG `<path>` Bezier curves with crossings
5. Optional stripe patterns via SVG `<pattern>` + `stroke-dasharray`
6. Invisible wider click targets behind each wire
7. Cut animation: wire splits/sparks on correct, red flash on error

*Module B — Symbol Dial:*
8. `DialModule.tsx` — 3 circular dials, each showing 1 of 6 symbols
9. Left/right arrows for rotation, vertical slide animation
10. "Confirm" button validates all 3 positions
11. Reset on wrong combination

*Module C — Button:*
12. `ButtonModule.tsx` — Large colored button with text label + indicator light + numeric display
13. State machine: `idle → pressed → holding → released`
14. Short press (<500ms) vs long press (>500ms, indicator cycles colors, release on target color)
15. Use `touchstart`/`touchend` on mobile

*Module D — Keypad:*
16. `KeypadModule.tsx` — 2x2 symbol grid, each cell clickable
17. Numbered badges (1-4) appear as clicked
18. Validate full sequence after 4th click; reset on wrong order

*Component tests for each module:*
19. Vitest + Testing Library — simulate clicks, verify correct/incorrect behavior, verify animation CSS classes

**Reference docs:**
- `docs/AmiClaw_MVP.md` §2.2 — module visual/interaction specs
- `docs/DesignSystem.md` — animation guidelines (300ms UI, 600ms game events), CSS-only constraint
- `docs/plans/2026-03-12-bombsquad-mvp-development.md` Phase 3 — detailed component specs

**Key files to create:**
| File | Role |
|------|------|
| `packages/game/src/modules/wire/WireModule.tsx` | Wire routing component |
| `packages/game/src/modules/wire/WireModule.module.css` | Wire styles |
| `packages/game/src/modules/dial/DialModule.tsx` | Symbol dial component |
| `packages/game/src/modules/dial/DialModule.module.css` | Dial styles |
| `packages/game/src/modules/button/ButtonModule.tsx` | Button component |
| `packages/game/src/modules/button/ButtonModule.module.css` | Button styles |
| `packages/game/src/modules/keypad/KeypadModule.tsx` | Keypad component |
| `packages/game/src/modules/keypad/KeypadModule.module.css` | Keypad styles |
| `packages/game/src/styles/animations.css` | Shared game animations |

- [ ] **Step 2:** Commit

---

## Task 4: Write Phase 4 — Game Flow + Manual System

- [ ] **Step 1:** Create `docs/plans/phase-4-game-flow-manual.md`

**Content outline:**
- **Goal:** Wire together the full game flow (4 pages, game state machine, timer) + build the manual system + create prompt templates
- **Prerequisites:** Phase 2 complete (rule engine for manual loading). Phase 3 NOT required for page shell — but wiring modules into GamePage requires Phase 3

**Tasks to include:**

*Game state management:*
1. `game-context.tsx` — React Context + useReducer for state machine: `LOADING → READY → PLAYING → MODULE_COMPLETE → (loop) → ALL_COMPLETE → RESULT`
2. `useTimer` hook — `performance.now()` + `requestAnimationFrame`, MM:SS format, never pauses
3. `useGameSession` hook — orchestrates module sequence, tracks errors/resets per module
4. `useDailyChallenge` hook — date-based manual URL resolution, attempt counter

*Pages:*
5. `HomePage` — Practice / Daily Challenge buttons, leaderboard link, prompt display with copy button, "How to Start" instructions
6. `GamePage` — Timer + current module + scene info bar (serial, batteries, indicators) + progress bar
7. `ResultPage` — Time breakdown, module stats, today's best, global rank placeholder, copy summary (plain text), "Play Again" as dominant CTA
8. `LeaderboardPage` — Daily top 100 table (placeholder data until Phase 5)

*Shared UI components:*
9. `Timer` component — displays MM:SS with neon styling
10. `ProgressBar` component — shows module completion (filled/empty squares)
11. `SceneInfoBar` component — displays serial number, battery count, indicator lights

*Manual system:*
12. Create `packages/manual/` directory structure
13. Build script (`packages/manual/build.ts`) — reads YAML, generates static HTML pages
14. HTML template — friendly top section ("This manual is for AI") + anti-human YAML rendering (4px font, #888 on #999, no line breaks)
15. Content negotiation — Cloudflare Pages Function middleware that returns clean YAML for `Accept: application/yaml` or `?format=yaml`

*Prompt templates:*
16. `prompts/standard-prompt.md` — with `{MANUAL_URL}` placeholder
17. `prompts/example-skills.md` — sample skills file
18. `prompts/review-template.md` — post-game debrief template

**Reference docs:**
- `docs/AmiClaw_MVP.md` §2.1 — page wireframes, UI element specs
- `docs/AmiClaw_MVP.md` §5 — prompt and skills design, post-game summary format
- `docs/AmiClaw_GameDesign.md` §2.3 — manual page design, URL format
- `docs/DesignSystem.md` — anti-human manual style spec

**Key files to create:**
| File | Role |
|------|------|
| `packages/game/src/store/game-context.tsx` | Game state management |
| `packages/game/src/hooks/useTimer.ts` | High-res timer hook |
| `packages/game/src/hooks/useGameSession.ts` | Game session orchestration |
| `packages/game/src/hooks/useDailyChallenge.ts` | Daily challenge logic |
| `packages/game/src/pages/HomePage.tsx` | Full home page |
| `packages/game/src/pages/GamePage.tsx` | Full game page |
| `packages/game/src/pages/ResultPage.tsx` | Full result page |
| `packages/game/src/pages/LeaderboardPage.tsx` | Leaderboard page |
| `packages/game/src/components/Timer.tsx` | Timer display |
| `packages/game/src/components/ProgressBar.tsx` | Module progress |
| `packages/game/src/components/SceneInfoBar.tsx` | Scene info display |
| `packages/manual/build.ts` | YAML → HTML build script |
| `packages/manual/src/template.html` | Manual HTML template |
| `packages/manual/src/anti-human.css` | Anti-human rendering styles |
| `prompts/standard-prompt.md` | Standard prompt template |
| `prompts/example-skills.md` | Example skills file |
| `prompts/review-template.md` | Post-game review template |

- [ ] **Step 2:** Commit

---

## Task 5: Write Phase 5 — Leaderboard Backend

- [ ] **Step 1:** Create `docs/plans/phase-5-leaderboard-backend.md`

**Content outline:**
- **Goal:** Build the leaderboard API (Cloudflare Workers + KV) and wire it into the game frontend
- **Prerequisites:** Phase 4 complete (result page exists to display rank, game flow generates submission data)

**Tasks to include:**

*API setup:*
1. Init `packages/api/` — Cloudflare Workers project with wrangler, TypeScript
2. Create KV namespace bindings — `LEADERBOARD` namespace

*API endpoints:*
3. `POST /api/leaderboard` — accepts `{ date, nickname, time_ms, attempt_number, module_times, operations_hash, ai_tool?, device_id }`, returns `{ rank, total_players }`
4. `GET /api/leaderboard?date=YYYY-MM-DD` — returns top 100 entries: `{ rank, nickname, time_ms, attempt_number, ai_tool }`

*KV schema:*
5. `leaderboard:YYYY-MM-DD` → JSON array of top 100 (read-modify-write with sorted insert)
6. `best:YYYY-MM-DD:{device_id}` → personal best time_ms (TTL: 48h)

*Anti-cheat:*
7. Operations hash verification (post-hoc detection)
8. Minimum time threshold — reject submissions < 15 seconds
9. Rate limiting — 1 submission / 10 seconds / device
10. Nickname sanitization — strip HTML, max 20 chars

*Frontend integration:*
11. Device fingerprint utility — `packages/game/src/utils/device-fingerprint.ts` (UUID in localStorage, regenerate if cleared)
12. Leaderboard API client — `packages/game/src/utils/leaderboard-api.ts`
13. Wire result page to submit scores
14. Wire leaderboard page to fetch and display top 100

*Shared types:*
15. `shared/leaderboard-types.ts` — submission and response types

**Reference docs:**
- `docs/AmiClaw_MVP.md` §6.3 — API spec
- `docs/plans/2026-03-12-bombsquad-mvp-development.md` Phase 5 — KV schema, anti-cheat details

**Key files to create:**
| File | Role |
|------|------|
| `packages/api/package.json` | Workers package |
| `packages/api/wrangler.toml` | Cloudflare Workers config |
| `packages/api/tsconfig.json` | Workers TS config |
| `packages/api/src/index.ts` | Worker entry, router |
| `packages/api/src/handlers/post-score.ts` | POST handler |
| `packages/api/src/handlers/get-leaderboard.ts` | GET handler |
| `packages/api/src/validation.ts` | Anti-cheat + sanitization |
| `shared/leaderboard-types.ts` | Submission/response types |
| `packages/game/src/utils/device-fingerprint.ts` | Device ID |
| `packages/game/src/utils/leaderboard-api.ts` | API client |

- [ ] **Step 2:** Commit

---

## Task 6: Write Phase 6 — Polish, Testing + Deploy

- [ ] **Step 1:** Create `docs/plans/phase-6-polish-testing-deploy.md`

**Content outline:**
- **Goal:** Responsive design, error handling, comprehensive testing, and Cloudflare Pages deployment
- **Prerequisites:** All prior phases complete

**Tasks to include:**

*Responsive design:*
1. Desktop (>768px) — puzzle area centered 60% width
2. Mobile (<768px) — full width, collapsible scene info bar, 44px+ touch targets
3. SVG viewBox handles scaling naturally

*Error handling:*
4. Manual load failure — retry button + local cache fallback
5. Generator exhaustion (100 tries) — error message + restart offer
6. Leaderboard API failure — local storage fallback, retry later, show results without rank
7. Clipboard fallback — `document.execCommand('copy')` for older browsers

*Testing:*
8. Unit tests — rule engine, generators, solvers, PRNG (should already exist from Phase 2, verify completeness)
9. Component tests — each module with simulated interactions (Vitest + Testing Library)
10. Integration test — full game flow: home → start → 4 modules → result
11. AI tool testing — manually test with Claude voice, ChatGPT voice, Gemini Live (verify manual parsing works)
12. Mobile testing — iOS Safari + Android Chrome with touch events
13. Responsive testing — desktop + mobile layouts at 768px breakpoint

*Deployment:*
14. Cloudflare Pages setup — connect repo, configure build commands
15. Game SPA build output — `packages/game/dist/`
16. Manual static pages — output from build script
17. Pages Functions — `/api/*` routes for leaderboard
18. Custom domain — `bombsquad.amio.fans` (CNAME to Pages, auto HTTPS)
19. Verify deployment — all pages load, manual URL works, leaderboard API responds

**Reference docs:**
- `docs/DesignSystem.md` — responsive breakpoints, touch target sizes
- `docs/plans/2026-03-12-bombsquad-mvp-development.md` Phase 6 — testing checklist, deployment details

- [ ] **Step 2:** Commit

---

## Task 7: Refactor Master Plan into Index

- [ ] **Step 1:** Refactor `docs/plans/2026-03-12-bombsquad-mvp-development.md`

Replace detailed per-phase content with a phase index table linking to individual plan files. Keep:
- Context section (project overview, current state, goal)
- Project structure (target directory tree)
- Phase index table (new — links, days, prerequisites, key deliverables)
- Dependency graph (ASCII diagram)
- Key risk areas table
- Critical files table

Remove: All detailed "What to build", "Key technical decisions", task lists, code snippets — these now live in individual phase plans.

**Phase index table format:**
```markdown
| Phase | Plan | Days | Prerequisites | Key Deliverables |
|-------|------|------|---------------|------------------|
| 1 | [Foundation](phase-1-project-foundation.md) | 1-2 | None | Monorepo, router, theme, PRNG, shared types, SVG symbols |
| 2 | [Rule Engine](phase-2-rule-engine-generators.md) | 3-5 | Phase 1 | Rule engine, 4 generators/solvers, practice YAML, unit tests |
| 3 | [Module UI](phase-3-puzzle-module-ui.md) | 6-10 | Phase 2 | Wire, Dial, Button, Keypad React components |
| 4 | [Game Flow](phase-4-game-flow-manual.md) | 11-14 | Phase 2 | 4 pages, state machine, timer, manual system, prompts |
| 5 | [Leaderboard](phase-5-leaderboard-backend.md) | 15-17 | Phase 4 | POST/GET API, KV schema, anti-cheat |
| 6 | [Polish+Deploy](phase-6-polish-testing-deploy.md) | 18-21 | All | Responsive, error handling, testing, Cloudflare deploy |
```

Note: Phases 3 and 4 can overlap — Phase 4 only needs Phase 2, not Phase 3. Wiring modules into GamePage is the only Phase 3 dependency in Phase 4.

- [ ] **Step 2:** Commit all 7 files together

---

## Verification

After all files are written:
- [ ] Each phase plan has: Goal, Architecture, Prerequisites, Tech Stack, Tasks with checkboxes, Verification section, Key files table
- [ ] Phase dependencies form a valid DAG: 1→2→{3,4}→5→6
- [ ] No duplicate content between plans (DRY)
- [ ] Every file path in the target project structure appears in exactly one phase plan
- [ ] Master index links to all 6 phase plans correctly
- [ ] All plans reference the correct design docs
