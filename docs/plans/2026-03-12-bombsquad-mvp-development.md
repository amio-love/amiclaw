# BombSquad MVP — Complete Development Plan

## Context

**AmiClaw** (`claw.amio.fans`) is a platform that hosts multiple agent+human collaborative game modes. **BombSquad** (`bombsquad.amio.fans`) is the first game on this platform — a bomb-defusing game inspired by "Keep Talking and Nobody Explodes". The player sees 2D puzzles on a web page and communicates via voice with any AI assistant (Claude, ChatGPT, Gemini, etc.) that reads a YAML manual to guide them. Zero AI integration needed — communication happens entirely through the player's physical voice.

**Platform architecture**: Each game on AmiClaw has its own subdomain (e.g., `bombsquad.amio.fans`). The platform landing page at `claw.amio.fans` will eventually link to all available games, but for MVP we focus solely on BombSquad.

**Current state**: Greenfield project. Only two design docs exist (`docs/AmiClaw_MVP.md` and `docs/AmiClaw_GameDesign.md`). No code yet.

**Goal**: Build a deployable BombSquad MVP in ~3 weeks that validates the core gameplay loop: "human describes + AI reads manual + human acts".

---

## Phase 0: Doc Updates (Before coding)

Update the two design docs to reflect correct domain and platform framing:

### `docs/AmiClaw_GameDesign.md`
- Replace all `bombsquad.amio` references with `bombsquad.amio.fans`
- Add a note in Section 1 clarifying AmiClaw is a multi-game platform, BombSquad is the first game
- Update architecture diagram URLs: `bombsquad.amio.fans`, `bombsquad.amio.fans/manual/2026-03-11`

### `docs/AmiClaw_MVP.md`
- Replace `bombsquad.amio.fun` with `bombsquad.amio.fans`
- Replace `bombsquad.amio/manual/2026-03-11` with `bombsquad.amio.fans/manual/2026-03-11`
- Update all manual URL references throughout the doc
- Update the prompt template URL placeholder

---

## Project Structure

```
amiclaw/
├── docs/                          # Design docs (platform + game)
├── packages/
│   ├── game/                      # BombSquad React SPA (Vite + TypeScript)
│   │   ├── src/
│   │   │   ├── main.tsx
│   │   │   ├── App.tsx            # Router setup
│   │   │   ├── components/        # Shared UI (Timer, ProgressBar, SceneInfoBar, ui/)
│   │   │   ├── pages/             # HomePage, GamePage, ResultPage, LeaderboardPage
│   │   │   ├── modules/           # 4 puzzle modules (wire/, dial/, button/, keypad/)
│   │   │   │   └── {module}/      # Each has: Module.tsx, generator.ts, solver.ts, types.ts
│   │   │   ├── engine/            # rng.ts, rule-engine.ts, puzzle-generator.ts, answer-validator.ts, game-state.ts
│   │   │   ├── store/             # game-context.tsx (React Context + useReducer), leaderboard.ts
│   │   │   ├── hooks/             # useTimer, useGameSession, useDailyChallenge
│   │   │   ├── utils/             # yaml-loader, device-fingerprint, clipboard, date
│   │   │   ├── styles/            # global.css (neon theme), animations.css
│   │   │   └── assets/symbols/    # SVG symbol definitions
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   └── package.json
│   ├── manual/                    # Manual static site
│   │   ├── src/                   # HTML template + anti-human CSS
│   │   ├── data/                  # practice.yaml + daily/*.yaml
│   │   └── build.ts              # YAML -> HTML page generator
│   └── api/                       # Cloudflare Workers (or Pages Functions)
│       └── src/                   # leaderboard handlers, validation
├── shared/                        # Shared TypeScript types
│   ├── manual-schema.ts           # YAML manual type definitions
│   ├── leaderboard-types.ts
│   └── symbols.ts                 # Symbol pool (id, name, SVG path)
├── prompts/                       # Prompt + skills templates
│   ├── standard-prompt.md
│   ├── example-skills.md
│   └── review-template.md
├── package.json                   # pnpm workspace root
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

**Key decisions**:
- **Monorepo with pnpm workspaces** — game SPA, manual site, and API worker are separate packages sharing types
- **Platform-ready structure** — the `packages/` layout allows adding future games alongside BombSquad (e.g., `packages/detective/`, `packages/explorer/`), while `shared/` holds cross-game types
- **Each puzzle module is self-contained** in its own directory (types + generator + solver + React component)
- **`shared/`** contains TypeScript types path-aliased via tsconfig, not a separate npm package
- **Domain**: `bombsquad.amio.fans` for the game SPA + manual pages; leaderboard API at `bombsquad.amio.fans/api/*`

---

## Phase 1: Project Foundation (Days 1–2)

### What to build
- Initialize monorepo: pnpm workspaces, tsconfig, .gitignore
- Set up Vite + React + TypeScript for the game SPA
- Set up React Router v6 (4 routes: Home, Game, Result, Leaderboard)
- Establish the neon/dark visual theme via CSS custom properties
- Implement seeded PRNG (`engine/rng.ts`) — mulberry32 algorithm (~15 LOC), providing `intBetween`, `pick`, `shuffle`, `float`
- Define all shared TypeScript interfaces (`shared/manual-schema.ts`, `shared/symbols.ts`)
- Create SVG symbol pool: 12–16 abstract symbols as SVG path data

### Key technical decisions
- **State management**: React Context + useReducer (no external library — game state is modest)
- **CSS**: CSS Modules + CSS custom properties for the neon theme (no CSS-in-JS)
- **Theme**: dark background `#1a1a2e`, neon accents (`#0ff`, `#39ff14`, `#ff073a`), monospace + sans-serif fonts
- **PRNG seed**: Practice mode uses constant seed `42`; daily challenge uses `Date.now()` at click

### Dependencies to install
- `react`, `react-dom`, `react-router-dom`
- `vite`, `@vitejs/plugin-react`, `typescript`
- `js-yaml` (for parsing YAML manuals at runtime)

---

## Phase 2: Rule Engine + Puzzle Generators (Days 3–5)

### What to build
- YAML manual parser + validator (`engine/rule-engine.ts`)
- Condition matcher supporting: equality, comparison (`gt`/`gte`/`lt`), counting, boolean (`odd`/`even`), presence, position
- All 4 puzzle generators (`{module}/generator.ts`) — parameterized random generation
- All 4 puzzle solvers (`{module}/solver.ts`) — compute correct answer from config + manual rules
- Answer validator (`engine/answer-validator.ts`)
- Write practice manual YAML (`manual/data/practice.yaml`)
- Unit tests for all generators and solvers (Vitest)

### Core logic design

**Rule engine** — the most critical piece:
```typescript
function matchCondition(condition, moduleConfig, sceneInfo): boolean;
function solveModule(moduleType, moduleConfig, manualRules, sceneInfo): ModuleAnswer;
```

**Generator validation loop** — each generator produces a random config, solver verifies unique answer. If ambiguous, regenerate (target <10% rejection rate).

**Module constraints** (from design doc):
| Module | Steps | Validation |
|--------|-------|------------|
| Wire | 1 (cut correct wire) | Exactly one rule matches |
| Dial | 3 (set 3 positions) | Exactly one column contains all 3 symbols |
| Button | 1 (tap or hold+release) | Exactly one rule chain matches |
| Keypad | 4 (click in order) | Exactly one sequence contains all 4 symbols |

### Testing
- Condition matcher: test every operator type
- Each solver: known configs with expected answers
- Each generator: 100 random generations all produce valid configs

---

## Phase 3: Puzzle Module UI (Days 6–10)

### What to build — 4 SVG-based React components

#### Module A: Wire Routing (`modules/wire/WireModule.tsx`)
- 4–5 colored wires as SVG `<path>` Bezier curves, left-to-right with crossings
- Optional stripe patterns via SVG `<pattern>` + `stroke-dasharray`
- Click target: invisible wider `<path>` behind each wire for easy clicking
- Cut animation: wire splits/sparks on correct cut; red flash on error

#### Module B: Symbol Dial (`modules/dial/DialModule.tsx`)
- 3 circular dials, each showing 1 of 6 symbols in a window
- Left/right arrow buttons for rotation with vertical slide animation
- "Confirm" button to validate all 3 positions
- Reset on wrong combination

#### Module C: Button (`modules/button/ButtonModule.tsx`)
- Large colored button with text label + indicator light + numeric display
- Two action types: short press (<500ms) or long press (>500ms, indicator cycles colors, release on target color)
- State machine: `idle → pressed → holding → released`
- Use `touchstart`/`touchend` on mobile (avoid synthesized events)

#### Module D: Keypad (`modules/keypad/KeypadModule.tsx`)
- 2×2 symbol grid, each cell clickable
- Numbered badges (1–4) appear as clicked
- Validate full sequence after 4th click; reset on wrong order

### Shared module interface
```typescript
interface ModuleProps {
  config: ModuleConfig;
  answer: ModuleAnswer;
  onComplete: () => void;
  onError: () => void;
  sceneInfo: SceneInfo;
}
```

### Animations (CSS-only, no JS library)
- **Success**: green flash, module-specific "disarmed" animation, 800ms pause
- **Error**: red flash, screen shake via CSS transform, `navigator.vibrate(200)` on mobile
- **Transitions**: crossfade between modules

---

## Phase 4: Game Flow + Manual System (Days 11–14)

### What to build

#### Pages
- **HomePage**: Practice / Daily Challenge buttons, leaderboard link, prompt display with copy button, "How to Start" instructions
- **GamePage**: Timer + current module + scene info bar (serial, batteries, indicators) + progress bar
- **ResultPage**: Times breakdown, module stats, today's best, global rank, copy summary, "Play Again"
- **LeaderboardPage**: Daily top 100 table

#### Game state machine
```
LOADING → READY → PLAYING → MODULE_COMPLETE → (loop) → ALL_COMPLETE → RESULT
```

#### Timer
- `performance.now()` for high-res timing
- Display updates via `requestAnimationFrame`
- MM:SS format; does NOT pause on module errors

#### Manual system (`packages/manual/`)
- **Browser view**: Friendly top section + anti-human YAML rendering (4px font, #888 on #999, no line breaks)
- **API/fetch view**: Clean YAML via content negotiation (check `Accept` header or `?format=yaml`)
- Build script generates static HTML pages from YAML source files
- Cloudflare Pages Function middleware handles content negotiation

#### Prompt templates (`prompts/`)
- Standard prompt with `{MANUAL_URL}` placeholder
- Example skills file
- Review/debrief template

---

## Phase 5: Leaderboard Backend (Days 15–17)

### API endpoints (Cloudflare Workers + KV)

**POST /api/leaderboard**
```typescript
{ date, nickname, time_ms, attempt_number, module_times, operations_hash, ai_tool?, device_id }
→ { rank, total_players }
```

**GET /api/leaderboard?date=YYYY-MM-DD**
→ Top 100 entries: `{ rank, nickname, time_ms, attempt_number, ai_tool }`

### KV schema
- `leaderboard:YYYY-MM-DD` → JSON array of top 100 (read-modify-write)
- `best:YYYY-MM-DD:{device_id}` → personal best time_ms (TTL: 48h)

### MVP anti-cheat
- Operations hash for post-hoc detection
- Minimum time threshold (reject <15s)
- Rate limit: 1 submission / 10s / device
- Nickname sanitization (strip HTML, max 20 chars)

### Device fingerprint
- UUID in localStorage; regenerate if cleared
- No invasive fingerprinting (no canvas, etc.)

---

## Phase 6: Polish + Testing + Deploy (Days 18–21)

### Responsive design
- Desktop (>768px): puzzle area centered 60% width
- Mobile (<768px): full width, collapsible scene info, 44px+ touch targets
- SVG viewBox handles scaling naturally

### Error handling
- Manual load failure → retry button + local cache fallback
- Generator exhaustion (100 tries) → error + restart offer
- Leaderboard API failure → local storage, retry later, show results without rank
- Clipboard fallback → `document.execCommand('copy')`

### Testing checklist
- [ ] Unit tests: rule engine, generators, solvers, PRNG (Vitest)
- [ ] Component tests: each module with simulated interactions (Vitest + Testing Library)
- [ ] Integration: full game flow (home → game → 4 modules → result)
- [ ] AI tool testing: Claude voice, ChatGPT voice, Gemini Live — verify manual parsing
- [ ] Mobile testing: iOS Safari + Android Chrome with touch
- [ ] Responsive: desktop + mobile layouts

### Deployment
- Cloudflare Pages: game SPA (`packages/game/dist/`) + manual static pages
- Pages Functions: `/api/*` routes for leaderboard
- Custom domain: `bombsquad.amio.fans` (CNAME to Pages, auto HTTPS)
- Future: `claw.amio.fans` as platform landing page linking to all games

---

## Dependency Graph

```
Phase 1 (Foundation)
  └→ Phase 2 (Engine)
       ├→ Phase 3 (Module UI)  ← depends on generators/solvers
       └→ Phase 4 (Game Flow)  ← depends on engine for manual loading
            └→ Phase 5 (Leaderboard) ← depends on result data shape
                 └→ Phase 6 (Polish) ← depends on everything
```

Phases 3 and 4 can partially overlap: module UIs and game page shell are independent.

---

## Key Risk Areas

| Risk | Mitigation |
|------|------------|
| Symbols too similar or too easy to describe | Design 16+ symbols, playtest to select best subset; pool is easy to swap |
| Rule engine edge cases | Comprehensive unit tests for every operator type |
| Button long-press timing on mobile | Use `touchstart`/`touchend` directly, add 200ms release tolerance |
| AI tools can't parse manual URL | Support `?format=yaml` + `?format=text`, test with 3 major AI tools |
| KV race conditions on leaderboard | Accept for MVP; migrate to D1/Durable Objects at scale |

---

## Critical Files

| File | Role |
|------|------|
| `docs/AmiClaw_MVP.md` | Authoritative design doc — needs domain updates (Phase 0) |
| `docs/AmiClaw_GameDesign.md` | Game design doc — needs domain + platform framing updates (Phase 0) |
| `packages/game/src/engine/rule-engine.ts` | Core logic: YAML condition matching + answer computation |
| `packages/game/src/engine/rng.ts` | Seeded PRNG used by all 4 generators |
| `shared/manual-schema.ts` | TypeScript types for YAML manual (contract for all components) |
| `packages/manual/data/practice.yaml` | First manual; integration test fixture for entire engine |
| `shared/symbols.ts` | SVG symbol pool shared by dial + keypad modules |
