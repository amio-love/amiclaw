# AGENTS.md

This file provides guidance to AI coding assistants working in this repository.
`CLAUDE.md` must remain a symlink to this file so all assistants read the same
project instructions.

## Project Overview

**AmiClaw** (`claw.amio.fans`) is a human-AI collaborative gaming platform.
**BombSquad** (`bombsquad.amio.fans`) is the first game: a voice-based
bomb-defusal challenge inspired by _Keep Talking and Nobody Explodes_, where the
human player and an AI expert communicate only through voice.

Key docs:

- Game design and mechanics: `docs/AmiClaw_GameDesign.md`
- MVP scope and requirements: `docs/AmiClaw_MVP.md`
- Design system: `docs/DesignSystem.md`
- Changelog authoring guide: `docs/changelog-style-guide.md`

## Contributor Conventions

Follow [CONTRIBUTING.md](CONTRIBUTING.md) for all contribution conventions.

## Tech Stack

| Layer               | Technology              |
| ------------------- | ----------------------- |
| Game frontend       | React + Vite SPA        |
| Puzzle rendering    | SVG                     |
| Puzzle generation   | Frontend TypeScript     |
| Manual page         | Static HTML + YAML      |
| Leaderboard backend | Cloudflare Workers + KV |
| Hosting             | Cloudflare Pages        |

## Key Game Mechanics

- The game page has no hints. All guidance comes from the AI voice partner.
- One module is displayed at a time, with a module progress bar at the bottom.
- A wrong answer resets only that module. The timer keeps running.
- "Play Again" is the most prominent CTA on the results page.
- The leaderboard shows time, attempt number, and the AI tool used when
  provided.
- The post-game summary must stay copyable plain text with no HTML formatting.

## Development Rules

- All code, comments, variable names, commit messages, and documentation must
  be in English.
- Puzzle answer calculation is client-side in the MVP. Do not move it to the
  server without flagging the security tradeoff.
- Never add a light mode. The product is dark-only by design.
- Do not add JavaScript animation libraries. CSS-only animation is a hard
  constraint.
- Read `docs/` before modifying game logic or UI layout.
- Read `docs/DesignSystem.md` before changing visual styling or CSS.
- Code quality: run the configured formatter and linter before committing.
- Changelog: for every change that will land on `main`, update `CHANGELOG.md`
  directly below the `Unreleased` header in the same change set.
- Release: when the user says "release" or "ship", follow the Release Workflow
  section in CONTRIBUTING.md and use `docs/changelog-style-guide.md` for
  changelog editing.
- CI: keep `.github/workflows/ci.yml` aligned with the repository's real
  install, lint, test, and build commands.
- PRs: all pull requests must use the PR template
  (`.github/pull_request_template.md`). The `main` branch currently has no
  required review or required status check, so admins can fast-merge; PRs are
  still preferred so CI runs and the diff is visible before it lands.
- Dependencies: Dependabot opens PRs for updates automatically. Patch and minor
  updates are auto-merged; major updates require manual review.
- Security: CodeQL runs on supported languages, dependency review blocks high
  and critical CVEs in PRs, and the Security tab must stay clean.
