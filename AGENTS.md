# AGENTS.md

This file provides guidance to AI coding assistants working in this repository.
`CLAUDE.md` must remain a symlink to this file so all assistants read the same
project instructions.

## Project Overview

**AmiClaw** (`claw.amio.fans`) is a human-AI collaborative gaming platform.
**BombSquad** (`claw.amio.fans/bombsquad`) is the first game: a voice-based
bomb-defusal challenge inspired by _Keep Talking and Nobody Explodes_, where the
human player and an AI expert communicate only through voice.

Key docs:

- System architecture (C4 model): `docs/architecture/architecture.md`
- BombSquad gameplay, player guide: `docs/bombsquad-player-guide.md`
- AmiClaw platform overview, player guide: `docs/amiclaw-platform-guide.md`
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
- The timer counts up from 00:00 (a stopwatch) in both modes. Time is a
  score, not a detonator: a faster run ranks higher on the daily leaderboard.
  A 1-hour hard cap ends either mode neutrally (no explosion) — it exists only
  to bound the displayed time, not as a deadline.
- The daily challenge uses a 3-strike fail rule, which is the only daily
  failure path: three wrong answers across the run detonate the bomb, with the
  first two surfaced as a visible strike count. Time never detonates the bomb.
  A wrong answer never resets the module — the same puzzle stays and the player
  retries it in place.
- Practice mode never fails. A wrong answer just lets the player retry the
  same puzzle in place; reaching the hard cap ends the run neutrally.
- Practice runs a reduced 2-module set; the daily challenge runs the full 4
  modules.
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
  still preferred so CI runs and the diff is visible before it lands. Every PR
  also gets an automatic Cloudflare Pages preview deployment, with the preview
  URL posted back as a sticky comment for mobile review.
- Dependencies: Dependabot opens PRs for updates automatically. Patch and minor
  updates are auto-merged; major updates require manual review.
- Security: CodeQL runs on supported languages, dependency review blocks high
  and critical CVEs in PRs, and the Security tab must stay clean.

## Beta Data Dashboard

A read-only HTML dashboard at `/api/dashboard?token=xxx` aggregates the
`events:{date}:*` KV keys (written by `/api/events`) into a per-day table of
game starts, completes, replay intents, and completion rates against the
70%/50% north-star thresholds. Open the URL directly in a browser.

- URL pattern: `https://claw.amio.fans/api/dashboard?token=<secret>`
- Set the token (Pages production environment):
  `wrangler secret put DASHBOARD_TOKEN`
- Source task: `add-beta-data-dashboard`.
- Internal-beta concern; consider removing after 2026-05-31.
