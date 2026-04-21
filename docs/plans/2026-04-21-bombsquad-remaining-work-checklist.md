# BombSquad Remaining Work Checklist — 2026-04-21

Supersedes `2026-03-27-bombsquad-remaining-work-checklist.md`. The 2026-03-27
document listed several product-correctness gaps that had in fact already been
shipped by the `feat: prepare gameplay validation deployment` commit earlier
in March. This file restates what is actually left as of 2026-04-21.

## What is already done (for future agents: do not re-plan these)

- Practice mode seeds its RNG deterministically via `PRACTICE_SEED`
  (`packages/game/src/utils/session.ts`), not from `Date.now()`.
- Daily attempt tracking is wired into the flow: `getAttemptNumberForMode`
  calls `reserveDailyAttempt`, which is bumped on every GamePage mount in
  daily mode and persisted in `sessionStorage` under `attempt-<date>`.
- Prompt generation splits by mode: `buildAssistantPrompt({ mode, manualUrl })`
  in `packages/game/src/utils/assistant-prompt.ts` plus a Practice / Daily
  toggle in `HomePage`.
- Leaderboard submissions hold to conservative MVP defaults: `nickname` is
  hard-coded to `"Anonymous"`, `ai_tool` is not collected from the UI, and
  `operations_hash` is an inline-commented `"mvp-placeholder"`.

## Summary

The game loop, manual pipeline, and leaderboard handlers all pass local
verification. The remaining work falls into three buckets:

1. Production deployment (needs Cloudflare access, not code)
2. A content shortage that makes daily mode unusable in the wild
3. A small set of lower-impact polish items

## 1. Daily manual content shortage (product blocker)

`packages/manual/data/daily/` contains a single file, `2026-03-16.yaml`.
Today is 2026-04-21. Daily mode fetches `/manual/YYYY-MM-DD` using today's
date, so a real user playing Daily Challenge today will hit a 404.

`GamePage` now distinguishes 404 ("manual not published") from other load
failures and shows a "Try Practice instead" fallback UI — this limits the
damage, but does not solve it. A manual content strategy still needs to be
chosen:

- Option A: hand-write more daily manuals (stays faithful to the MVP design
  intent that manuals are carefully designed, not auto-generated)
- Option B: write a deterministic manual generator keyed by date
- Option C: rotate a small pool of hand-written manuals by day-of-year
- Option D: defer daily mode until after production is live

This is a product decision, not an engineering one.

## 2. Production deployment

See `docs/BombSquad_Operations.md` for the full checklist. The items that
still block a real launch:

- Bind the `LEADERBOARD` KV namespace in Cloudflare and record the real ID
  in `packages/api/wrangler.toml` (currently a placeholder).
- Verify DNS / HTTPS for `bombsquad.amio.fans`.
- Run the live curl checks listed in the ops doc:
  - `/`
  - `/manual/practice`
  - `/manual/practice?format=yaml`
  - `/api/leaderboard?date=YYYY-MM-DD`
  - `POST /api/leaderboard`
- One full practice run with a voice AI tool.
- One full daily run with score submission.
- One mobile browser smoke test on a real phone.

## 3. Lower-impact polish

### `operations_hash` placeholder

Submissions currently send `operations_hash: "mvp-placeholder"`. Replace
with a real client-side digest of the run (seed + module configs + module
answers + module stats). It still will not stop a determined cheater, but
it makes each run uniquely identifiable and removes the "placeholder"
footgun before the API starts seeing real traffic.

### `ai_tool` capture

The shared schema accepts `ai_tool` but the UI does not collect it. Adding
an optional selector on `ResultPage` (Claude / ChatGPT / Gemini / other /
skip) lets the leaderboard show which tools people are succeeding with,
which is one of the MVP validation signals.

### Stale compiled JS under `packages/game/src/`

This was fully cleaned up in the 2026-04-21 PR (`fix/p2-docs-and-daily-404-ux`
and the earlier `fix/ci-set-state-in-effect`), and `.gitignore` now blocks
`packages/*/src/**/*.js(x)`. No action needed unless the pattern recurs.

### Docs

- `docs/BombSquad_Operations.md` is accurate as of this checklist.
- `docs/plans/2026-03-27-bombsquad-remaining-work-checklist.md` is superseded
  by this file.
