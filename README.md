# AmiClaw

**AmiClaw** (`claw.amio.fans`) is a platform for human-AI collaborative games,
where you and your AI work together in real time to solve challenges.

> **"Keep Us Human"** — The fun is not in the AI solving problems alone. It is
> in the two of you figuring them out together.

## BombSquad

**BombSquad** (`bombsquad.amio.fans`) is the first AmiClaw game, inspired by
_Keep Talking and Nobody Explodes_.

You are the bomb defuser. Your AI is the manual expert.

- You see a 2D bomb panel in your browser with wires, dials, buttons, and keypads
- Your AI reads a complex YAML manual through a shared URL
- You describe what you see by voice, and your AI tells you what to do
- You race the clock and compete on the global leaderboard

Communication happens entirely through voice, so the experience works with
Claude, ChatGPT, Gemini, or any other voice-capable AI tool.

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
- Practice mode with a fixed puzzle and no leaderboard
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
│   ├── api/                 # Cloudflare Workers leaderboard API
│   ├── game/                # BombSquad React SPA
│   └── manual/              # Manual static pages and YAML data
├── prompts/                 # Prompt and skill templates
├── scripts/                 # Release and maintenance scripts
└── shared/                  # Shared TypeScript types
```

## Development

Install dependencies and start the development workflow from the repository root:

```bash
pnpm install
pnpm dev
```

Common commands:

```bash
pnpm lint
pnpm test:run
pnpm build
```

Workspace notes:

- `packages/game` contains the React + Vite game client
- `packages/manual` builds the static manual pages and YAML data
- `packages/api` contains the Cloudflare Workers leaderboard API

See [`docs/plans/`](./docs/plans/) for implementation plans and
[`CONTRIBUTING.md`](./CONTRIBUTING.md) for contribution and release guidance.

## Links

- Platform: [claw.amio.fans](https://claw.amio.fans)
- BombSquad: [bombsquad.amio.fans](https://bombsquad.amio.fans)
- Part of the [AMIO](https://amio.fans) ecosystem
