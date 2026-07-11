# AMIO Arcade

**AMIO Arcade** (`claw.amio.fans`, formerly AmiClaw) is a platform for
human-AI collaborative games, where you and your AI work together in real time
to solve challenges. The repository, workspace package scope, Cloudflare Pages
project, and current production host still use the `amiclaw` / `claw.amio.fans`
compatibility identifiers.

> **"Keep Us Human"** — The fun is not in the AI solving problems alone. It is
> in the two of you figuring them out together.

## BombSquad

**BombSquad** (`claw.amio.fans/bombsquad`) is the first AMIO Arcade game,
inspired by _Keep Talking and Nobody Explodes_.

You are the bomb defuser. Your AI is the manual expert.

- You see a 2D bomb panel in your browser with wires, dials, buttons, and keypads
- Your AI reads a complex YAML manual through a shared URL
- You describe what you see by voice, and your AI tells you what to do
- You race the clock and compete on the global leaderboard

Communication happens entirely through voice, so the experience works with
Claude, ChatGPT, Gemini, or any other voice-capable AI tool.

## Dual Shadow Chase

**Dual Shadow Chase** (`claw.amio.fans/shadow-chase`) is a two-to-five-minute
solo real-time grid chase for one human and the existing AI companion.

- Use a Chinese-first setup, planning, play, and result surface
- Inspect the complete frozen map during a 20-second tactical-planning phase;
  adjust it from 5 to 60 seconds in five-second steps or start early
- Collect three cores and reach the exit while a pursuer searches the map
- Plan against one public pursuer rule: unobstructed row/column sight, the
  player as the only pursuit target, and moon-gate return when the player is hidden
- Command the companion to support, scout the next core, or establish a distant anchor
- Earn one position swap for every collected core
- Rescue a captured shadow before its deadline
- Queue rapid movement inputs FIFO, tap a persistent destination path, and see
  why a blocked move was rejected
- Optionally discuss strategy by voice with the authenticated account companion;
  only an explicit final player command can select support, scout, or anchor
- Keep playing through anonymous, microphone, provider, model, or network failure

Voice reuses the platform's existing companion identity, voice, provider adapters,
and memory boundary. It is opt-in and bounded; neither voice nor model work can
pause planning or frame-level play. The deterministic engine owns movement and
outcomes, and the Chinese strategy buttons remain authoritative fallback controls.
The pursuer cannot read those strategy buttons, model output, or the companion's
position when selecting a destination. It moves every tick and takes a public,
difficulty-dependent bonus step often enough to stay slightly faster than both
shadows. The companion is never targeted, but same-cell contact and opposite-edge
crossing still capture it. Difficulty changes the bonus-step interval and rescue
time, not visibility or target selection.

On the Arcade homepage, BombSquad remains the sole featured game. Dual Shadow
Chase and the Yijing Oracle appear together in the playable peer grid. Arcade
supports one human plus one AI companion; rooms, matchmaking, human co-op, PvP,
and voice rooms belong to the AMIO main world.

## How It Works

```text
You (browser) <-> voice <-> AI (reads manual URL)
     |                             |
  See puzzle                 Look up YAML rules
  Click controls             Give spoken instructions
  Beat the clock             Help refine each run
```

## Roguelike Daily Challenge

- Every day, a new manual is published
- The manual stays fixed all day, so your AI can master it across runs
- Every time you click Start, a new random puzzle is generated from that day's rules
- You get unlimited attempts, and the leaderboard records your personal best
- You can debrief with your AI after each run and refine your strategy

## MVP Features

- Four puzzle modules: Wire Routing, Symbol Dial, Button, and Keypad
- Practice mode with a fresh random puzzle each run (stable practice manual) and no leaderboard
- Daily challenge mode with random puzzles and a global leaderboard
- Anti-human manual rendering, with clear YAML for AI and obfuscated rendering for humans
- A post-run summary for AI-assisted debriefing
- Prompt and skill templates

## Tech Stack

| Component         | Technology                |
| ----------------- | ------------------------- |
| Game SPA          | React + Vite + TypeScript |
| Puzzle rendering  | SVG                       |
| Puzzle generation | Frontend TypeScript       |
| Manual pages      | Static HTML + YAML        |
| Leaderboard API   | Cloudflare Workers + KV   |
| Hosting           | Cloudflare Pages          |

## Project Structure

```text
amiclaw/
├── docs/                    # Design documents and plans
├── packages/
│   ├── api/                 # Leaderboard handler module (Pages Functions)
│   ├── platform/            # Platform shell and deploy root
│   ├── game-bombsquad/      # BombSquad React SPA
│   ├── game-shadow-chase/   # Dual Shadow Chase React SPA
│   ├── game-yijing/         # Yijing Oracle React SPA
│   ├── ui/                  # Shared Atlas UI primitives
│   └── manual/              # Manual static pages and YAML data
├── prompts/                 # Prompt and skill templates
├── scripts/                 # Release and maintenance scripts
└── shared/                  # Shared TypeScript types
```

## Development

Install dependencies and start the development workflow from the repository root:

The repository now contains working local implementations for the game, manual
pipeline, and leaderboard handlers.

Core local verification:

```bash
pnpm test:run
pnpm build
pnpm --filter api typecheck
```

Recommended local workflow:

```bash
pnpm install
pnpm dev
```

Operational notes:

- Manual sources live in `packages/manual/data/`
- `pnpm build` assembles all game and manual assets into `packages/platform/dist/`
  for Cloudflare Pages
- The current UI keeps leaderboard nickname anonymous by default
- `ai_tool` is supported by the schema but not collected by the current UI yet
- `operations_hash` is still an MVP placeholder in the current submission flow

See [`docs/BombSquad_Operations.md`](./docs/BombSquad_Operations.md) for
deployment layout, manual publishing steps, and live verification tasks.

Common commands:

```bash
pnpm lint
pnpm test:run
pnpm build
```

Workspace notes:

- `packages/platform` contains the React + Vite platform shell and deploy root
- `packages/game-bombsquad` contains the BombSquad React + Vite game client
- `packages/game-shadow-chase` contains the Dual Shadow Chase React + Vite game client
- `packages/game-yijing` contains the Yijing Oracle React + Vite game client
- `packages/manual` builds the static manual pages and YAML data
- `packages/api` contains the leaderboard handler module imported by Pages Functions

See [`docs/plans/`](./docs/plans/) for implementation plans and
[`CONTRIBUTING.md`](./CONTRIBUTING.md) for contribution and release guidance.

## Links

- AMIO Arcade: [claw.amio.fans](https://claw.amio.fans)
- BombSquad: [claw.amio.fans/bombsquad](https://claw.amio.fans/bombsquad)
- Dual Shadow Chase: [claw.amio.fans/shadow-chase](https://claw.amio.fans/shadow-chase)
- Part of the [AMIO](https://amio.fans) ecosystem
