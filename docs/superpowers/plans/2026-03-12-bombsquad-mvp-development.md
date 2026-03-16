# BombSquad MVP — Development Plan Index

## Context

**AmiClaw** (`claw.amio.fans`) is a platform that hosts multiple agent+human collaborative game modes. **BombSquad** (`bombsquad.amio.fans`) is the first game on this platform — a bomb-defusing game inspired by "Keep Talking and Nobody Explodes". The player sees 2D puzzles on a web page and communicates via voice with any AI assistant (Claude, ChatGPT, Gemini, etc.) that reads a YAML manual to guide them. Zero AI integration needed — communication happens entirely through the player's physical voice.

**Current state**: Greenfield project. Only design docs exist. No code yet.

**Goal**: Build a deployable BombSquad MVP in ~3 weeks that validates the core gameplay loop: "human describes + AI reads manual + human acts".

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
│   │   │   ├── components/        # Shared UI (Timer, ProgressBar, SceneInfoBar)
│   │   │   ├── pages/             # HomePage, GamePage, ResultPage, LeaderboardPage
│   │   │   ├── modules/           # 4 puzzle modules (wire/, dial/, button/, keypad/)
│   │   │   │   └── {module}/      # Each has: Module.tsx, generator.ts, solver.ts, types.ts
│   │   │   ├── engine/            # rng.ts, rule-engine.ts, answer-validator.ts
│   │   │   ├── store/             # game-context.tsx (React Context + useReducer)
│   │   │   ├── hooks/             # useTimer, useGameSession, useDailyChallenge
│   │   │   ├── utils/             # yaml-loader, device-fingerprint, clipboard, date
│   │   │   └── styles/            # global.css (neon theme), animations.css
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   └── package.json
│   ├── manual/                    # Manual static site
│   │   ├── src/                   # HTML template + anti-human CSS
│   │   ├── data/                  # practice.yaml + daily/*.yaml
│   │   └── build.ts              # YAML → HTML page generator
│   └── api/                       # Cloudflare Workers (leaderboard)
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

---

## Phase Index

| Phase | Plan | Days | Prerequisites | Key Deliverables |
|-------|------|------|---------------|------------------|
| 1 | [Foundation](phase-1-project-foundation.md) | 1–2 | None | Monorepo, router, CSS tokens, PRNG, shared types, SVG symbols |
| 2 | [Rule Engine](phase-2-rule-engine-generators.md) | 3–5 | Phase 1 | Condition matcher, 4 generators/solvers, practice YAML, unit tests |
| 3 | [Module UI](phase-3-puzzle-module-ui.md) | 6–10 | Phase 2 | Wire, Dial, Button, Keypad React components with CSS animations |
| 4 | [Game Flow](phase-4-game-flow-manual.md) | 11–14 | Phase 2 | 4 pages, state machine, timer, manual system, prompt templates |
| 5 | [Leaderboard](phase-5-leaderboard-backend.md) | 15–17 | Phase 4 | POST/GET API, KV storage, anti-cheat, frontend wiring |
| 6 | [Polish + Deploy](phase-6-polish-testing-deploy.md) | 18–21 | All phases | Responsive, error handling, full test suite, Cloudflare deploy |

**Note:** Phases 3 and 4 can be developed in parallel. Phase 4 only depends on Phase 2 (rule engine for manual loading). The only Phase 3 dependency in Phase 4 is wiring the module components into `GamePage`.

---

## Dependency Graph

```
Phase 1 (Foundation)
  └→ Phase 2 (Rule Engine + Generators)
       ├→ Phase 3 (Module UI)      ← SVG components, CSS animations
       └→ Phase 4 (Game Flow)      ← pages, state machine, manual system
            └→ Phase 5 (Leaderboard) ← API + KV + frontend wiring
                 └→ Phase 6 (Polish + Deploy) ← everything comes together
```

---

## Key Risk Areas

| Risk | Mitigation |
|------|------------|
| Symbols too similar or too hard to describe verbally | Design 16 symbols, playtest to select best subset; pool is easy to swap |
| Rule engine edge cases (multi-condition AND, operator types) | Comprehensive unit tests for every operator type (Phase 2) |
| Button long-press timing on mobile | Use `onPointerDown`/`onPointerUp` directly, add 200ms release tolerance |
| AI tools can't parse manual URL | Support `?format=yaml` + `?format=text`, test with 3 major AI tools (Phase 6) |
| KV race conditions on leaderboard | Accept for MVP; migrate to D1/Durable Objects at scale |
| Generator produces ambiguous configs | Validation loop rejects and regenerates; target <10% rejection rate |

---

## Critical Files

| File | Role | Phase |
|------|------|-------|
| `docs/AmiClaw_MVP.md` | Authoritative design doc | — |
| `docs/AmiClaw_GameDesign.md` | Game design doc | — |
| `docs/DesignSystem.md` | CSS + visual rules | — |
| `packages/game/src/engine/rng.ts` | Seeded PRNG used by all 4 generators | 1 |
| `shared/manual-schema.ts` | TypeScript types for YAML manual (shared contract) | 1–2 |
| `shared/symbols.ts` | SVG symbol pool shared by Dial + Keypad | 1 |
| `packages/game/src/engine/rule-engine.ts` | Core logic: condition matching | 2 |
| `packages/manual/data/practice.yaml` | First manual; integration test fixture | 2 |
| `packages/game/src/store/game-context.tsx` | Game state machine | 4 |
| `packages/api/src/index.ts` | Worker entry point | 5 |
