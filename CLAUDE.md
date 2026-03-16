# CLAUDE.md — AmiClaw

Project-level guidance for Claude Code when working in this repository.
User's global CLAUDE.md at `~/.claude/CLAUDE.md` also applies; project rules take precedence where they conflict.

---

## Project Overview

**AmiClaw** (`claw.amio.fans`) is a human-AI collaborative gaming platform.
**BombSquad** (`bombsquad.amio.fans`) is the first game: a voice-based bomb-defusal challenge inspired by *Keep Talking and Nobody Explodes*, where the human player and an AI expert communicate only through voice.

Key docs:
- Game design & mechanics: `docs/AmiClaw_GameDesign.md`
- MVP scope & requirements: `docs/AmiClaw_MVP.md`
- Design system (colors, typography, CSS rules, animations): `docs/DesignSystem.md`

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Game frontend | React + Vite (SPA, pure frontend) |
| Puzzle rendering | SVG |
| Puzzle generation | Frontend JS |
| Manual page | Static HTML + YAML |
| Leaderboard backend | Cloudflare Workers + KV |
| Hosting | Cloudflare Pages |

---

## Key Game Mechanics

- The game page has **no hints** — all guidance comes from the AI voice partner
- One module displayed at a time; module progress bar at the bottom
- Wrong answer resets **only that module** (re-randomizes), timer keeps running
- "Play Again" is the most prominent CTA on the results page (roguelike loop)
- Leaderboard shows: time, attempt number, AI tool used (optional)
- Post-game summary is copyable plain text for AI debrief — no HTML

---

## Development Rules

- All code, comments, variable names, and commit messages must be in **English**
- Puzzle answer calculation is client-side in MVP — accepted technical debt; do not move to server without flagging the security tradeoff
- Never add a light mode — dark-only by design
- Do not add JS animation libraries — CSS-only is a hard constraint
- Read `docs/` before modifying any game logic or UI layout
- Read `docs/DesignSystem.md` before making any visual or CSS changes
