# BombSquad Remaining Work Checklist

## Summary

The core MVP game loop is implemented and currently passes local verification (`pnpm test:run`, `pnpm build`, `pnpm --filter api typecheck`). The highest-impact remaining work is not the AI-facing manual itself. That already exists. The main gaps are production readiness, a few product-behavior mismatches, and stale documentation.

Priority order:
1. Fix gameplay and data mismatches that affect user-facing correctness
2. Finish deployment and production configuration
3. Complete real-world verification for manual delivery, AI usability, and mobile play
4. Refresh docs so the repo matches the shipped state

## Key Changes

### 1. Fix user-facing behavior mismatches first

- Make practice mode deterministic instead of seeding from `Date.now()`.
- Wire daily attempt tracking into the actual game flow so attempt counts increment and persist correctly.
- Split prompt generation by mode so the copied prompt uses the correct manual URL for practice vs daily challenge.
- Keep MVP leaderboard submissions conservative until real collection is implemented:
  - `nickname`: keep anonymous by default
  - `ai_tool`: remove from active UI expectations until supported
  - `operations_hash`: explicitly treat as a temporary placeholder in docs

### 2. Finish deployment configuration

- Fill real KV namespace IDs in the API worker config once Cloudflare resources exist.
- Define the production hosting layout for game SPA, manual pages, and `/manual/*` function routing.
- Verify `VITE_API_BASE` and CORS match the final production origin.
- Confirm the manual HTML output and YAML negotiation are both reachable in production.
- Treat production verification as incomplete until these URLs are tested live:
  - `/`
  - `/manual/practice`
  - `/manual/practice?format=yaml`
  - `/api/leaderboard?date=YYYY-MM-DD`
  - `POST /api/leaderboard`

### 3. Complete content and ops gaps

- Decide how daily manuals will be created and published after the single existing dated example.
- Add at least one explicit operating procedure for publishing a new daily manual.
- Decide whether practice should remain local-bundled only or also be served consistently through the same production manual pipeline.

### 4. Refresh stale documentation

- Update the README to reflect that implementation exists and the repo is no longer greenfield.
- Replace outdated “coming soon / no code yet” statements in planning/index docs that are now misleading.
- Add a short operator-facing note describing the current manual system:
  - YAML source
  - anti-human HTML rendering
  - `?format=yaml` AI access path

## Public Interfaces / Data Contracts

- `GET /manual/:date`:
  - Browser default returns HTML
  - `?format=yaml` and plain-text style requests return the raw YAML/manual text
- `POST /api/leaderboard`:
  - MVP keeps `nickname` anonymous by default
  - `ai_tool` is supported by the schema but not collected by the UI yet
  - `operations_hash` remains a temporary placeholder until real run hashing is implemented
- Home page prompt UX:
  - Prompt copy must vary by selected mode and point to the correct manual URL

## Test Plan

- Re-run current local checks after each behavior change:
  - `pnpm test:run`
  - `pnpm build`
  - `pnpm --filter api typecheck`
- Add or update tests for:
  - deterministic practice runs
  - attempt counter increment/persistence
  - prompt text using the correct manual URL per mode
  - leaderboard submission payload shape if metadata fields change
- Manual production verification:
  - HTML manual route works in browser
  - YAML route returns clean machine-readable content
  - leaderboard GET/POST succeed against deployed infrastructure
- Human verification:
  - one full practice run with at least one AI tool
  - one daily run with score submission
  - mobile smoke test on a narrow viewport and at least one real phone browser

## Assumptions

- The existing AI-facing manual and prompt/debrief assets are accepted as the MVP baseline and do not need a net-new rewrite.
- Deployment has not been completed yet because KV IDs and production routing are still unfinished.
- The best next step is to resolve correctness mismatches before touching docs polish, because those mismatches affect real gameplay and data quality.
- If scope must stay tight, collecting real `ai_tool` and nickname can be deferred, but the UI and docs should stop implying those fields are fully supported until implemented.
