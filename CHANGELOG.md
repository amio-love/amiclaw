# Changelog

All notable changes to this project will be documented in this file.
Versions follow [Semantic Versioning](https://semver.org).

## [Unreleased](https://github.com/amio-love/amiclaw/compare/0.0.0...HEAD)

### Added

- **Audio + animation feedback** Every in-module click now gives a short
  pulse animation and a sound effect (confirm, wire-cut, dial-rotate,
  keypad-press, button-down/up). Solving or failing a module plays a soft
  success / error thunk. A mechanical-stopwatch tick now loops in the
  background while the timer is running and stops as soon as the round
  ends. Sounds are driven by three CC0 base samples (Kenney UI Audio,
  ~20 KB total) and varied per operation via Web Audio playback-rate; no
  new runtime dependencies. Animations are pure CSS keyframes wrapped in
  `prefers-reduced-motion`.
- Frontend event logging for practice/daily games (game_start, module_solve, game_complete, game_abandon, manual_load_failed) — emitted via console.info with prefix [bombsquad-event] for manual analysis of completion rate
- `replay_intent` console.info event emitted when the result-page "再来一局" button is clicked — enables manual estimation of replay-willingness (roadmap §Strategic Objectives Validation Criteria #3, 复玩意愿 ≥50%) from console logs
- Backend event ingestion via Pages Function `/api/events` — five existing event types (game_start, module_solve, game_complete, game_abandon, manual_load_failed) plus replay_intent now POST to a Cloudflare Pages Function that writes per-event-name counters and unique-device sets to the LEADERBOARD KV namespace under `events:{date}:*` keys. Frontend `console.info` channel is replaced by fire-and-forget fetch; events include device_id (sourced from the same localStorage UUID used by leaderboard submissions) so both session-level and unique-player completion-rate can be computed.

### Improvements

- **Test runner self-containment** Internal refactor — `packages/manual` now
  has its own vitest setup, and the cross-SSOT character-equal guard tests
  (manual yaml symbols matching `shared/symbols.ts`) live in the manual
  package alongside the data they test. The game-package test file is back
  to schema-unit only, and root `pnpm test:run` runs both packages via
  `-r run` (CI inherits automatically).
- **Post-refresh guidance** A short banner appears at the top of the game
  page after an accidental F5 / Cmd+R, diagnosing what just happened so the
  player can decide how to re-sync with their AI partner. The copy now
  describes the situation in two lines — that the page state was reset, and
  that the AI partner is still waiting on the previous step — without
  prescribing an action. The banner auto-dismisses after 5 seconds, and the
  × button remains for players who want to clear it sooner.
- **Prompt-copy modal** The home page no longer shows the assistant prompt
  inline. Clicking 「练习」or「每日挑战」now opens a small modal with the
  matching manual URL and a copy button; the player sends the URL to their AI
  partner, then presses「确认开始游戏」to enter the run. The "怎么开始"
  panel is condensed to four steps reflecting the new flow. Updated MVP §6.2
  data flow and roadmap Shipped 标准 to reflect the new URL-copy step.
- **Recap copy wording** Result-page summary text aligned with the MVP
  section 5.3 example wording (header, result, module rows, retro intro).
- **Manual symbol vocabulary** Each abstract symbol (omega, psi, trident,
  etc.) now ships with a visual description so AI partners can disambiguate
  player descriptions ("三叉戟" vs psi, "扇子" vs trident, etc.) without
  round-trip clarification. Manual YAMLs gained a top-level `symbols:` block
  with Chinese descriptions that explicitly call out the most common
  confusions; the build pipeline fails loudly if a symbol referenced in
  `symbol_dial.columns` or `keypad.sequences` lacks a description (or if
  the block declares an unused entry). The assistant prompt's "符号视觉
  对照" section is generated from the same SSOT so the prompt and the
  manual stay in lockstep, and a vitest assertion now also enforces that
  every shipped yaml `symbols.<id>.description` is character-equal to the
  `SYMBOLS` registry entry, catching silent drift between the two surfaces
  before it reaches deploy.
- **Manual symbol description SSOT** Symbol descriptions now live in only
  one place — `shared/symbols.ts`. The source manual YAMLs and the dist
  raw YAMLs no longer carry a `symbols:` block; instead `packages/manual/build.ts`
  derives each referenced symbol's description from the `SYMBOLS` registry
  at build time and injects them into the YAML embedded in the rendered
  manual HTML. The cross-SSOT character-equal guard now reads the embedded
  HTML YAML instead of the source files, and a new test locks in that
  neither the source nor the dist raw YAMLs ever re-introduce a `symbols:`
  block. Developers edit a description in one file; CI continues to catch
  any manual reference to an unregistered symbol id. Known trade-off: the
  `?format=yaml` AI path no longer ships descriptions in the raw asset —
  the assistant prompt remains the SSOT for consumers on that path.
- **Leaderboard live update** Submitted scores now appear in the leaderboard
  immediately, replacing the previous up-to-60-second cache-invalidation lag.
  After a successful POST the result page persists an optimistic entry in
  sessionStorage; the leaderboard view splices it in at the returned rank
  (with a `data-just-submitted` marker) until the next GET refresh returns
  the authoritative copy.
- **API package cleanup** Removed dormant standalone Worker entry from
  `packages/api`; Pages Functions remains the sole leaderboard API path.
  README workspace note also updated to reflect the new shape: `packages/api`
  is now described as the leaderboard handler module imported by Pages
  Functions.
- **Refresh resilience** An accidental F5 / Cmd+R mid-run no longer wipes
  the current game. GameState is mirrored into sessionStorage on every
  transition, the timer is now driven by wall-clock `Date.now()` so the
  persisted start time stays meaningful across page loads, and per-module
  timing / error counting moved from refs into the reducer so they survive
  a refresh too. A new "退出" button in the in-game top bar is the only
  deliberate way to clear the run (with a confirmation dialog); closing
  the tab also clears, since we use sessionStorage rather than localStorage
- **Localization** Full Simplified-Chinese translation of every player-facing
  string — home page, game HUD, Scene Info bar labels, result page, leaderboard,
  404 "manual not published" fallback, assistant prompt, and the human-readable
  banner on the manual page. Schema values (wire colors, symbol IDs, module
  slugs) remain English because they are matched as enum IDs by generators and
  solvers; the AI bridges Chinese player descriptions to the English data
- **Cloudflare Pages deployment** GitHub Actions can now build the monorepo and
  publish the assembled Pages artifact with `wrangler pages deploy`, avoiding
  the broken dashboard deploy-command path.
- **Leaderboard storage wiring** The `LEADERBOARD` KV namespace IDs are now
  recorded in `wrangler.toml` and the binding is attached to the Pages project,
  so the daily leaderboard endpoints persist scores in production instead of
  returning a Workers runtime error.

### Fixed

- **Daily challenge no longer crashes on missing dates** Every date for the
  next year now serves a real daily manual derived deterministically from
  the practice rulebook, so opening "每日挑战" on any date through
  2027-05-11 loads a playable bomb instead of throwing
  "谜题生成失败". Generator script `scripts/generate-daily-from-practice.mjs`
  permutes the practice rules with a date-seeded RNG and writes one YAML
  per day; same date always produces the same bomb.
- **Friendly fallback for unpublished dates** Cloudflare now routes
  `/manual/<date>` through the Pages Function before the SPA catch-all,
  so requests for dates without a published manual return a clean 404
  and the game renders the existing "今天的手册还没发布" UI with the
  "去练习" CTA instead of a broken SPA shell that crashed puzzle
  generation. The fix is a new `_routes.json` alongside the existing
  `_redirects`; the SPA continues to handle every other route.
- **Post-refresh banner no longer false-fires on in-SPA navigation** The
  refresh-detection signal is now consumed on first read per document load,
  so exiting back to the home page and starting a new run — or returning from
  the result page via 再来一局, or falling through to practice from a 404
  daily manual — no longer surfaces the banner. The banner still appears once
  after a genuine browser refresh and is gone for the rest of that document's
  lifetime.
- **Manual URL self-heals across domains** The prompt players copy into
  their AI, and the URL the game fetches daily manuals from, both now
  use `window.location.origin` instead of a hardcoded
  `bombsquad.amio.fans`. A fresh deploy to `amiclaw.pages.dev` or any
  custom domain works immediately — previously the copied prompt pointed
  at a hostname that hadn't been wired up yet and the AI hit 404
- **Symbol dial communication** Rewrote the dial module's manual rule prose so
  the AI partner no longer gives "rotate dial N until you see symbol X"
  instructions — which frequently fail because each dial has its own
  independent 6-symbol pool and X may not exist on that dial. The new prose
  spells out that the target is an _index_ into the matching column (0–5),
  and the assistant prompt now includes a dedicated dial-module clarification
  block plus a symbol alias table generated directly from `SYMBOLS` so the
  prompt can never drift from the actual rendered shapes (no more
  `star = 六角星` when the SVG is a five-pointed star). Also tightened the
  dial generator so the three starting symbols are always pairwise distinct
  — previously the independent per-dial shuffle could produce duplicates,
  which made any reasonable LLM conclude "columns contain each symbol only
  once, so two dials cannot share a symbol, so the player must be wrong"
  and refuse to proceed
- **Pages deploy workflow** Hoisted `wrangler` to a root devDependency so
  `pnpm exec wrangler` resolves at the workspace root. The previous setup
  had wrangler only in `packages/api`, so `cloudflare/wrangler-action` on
  every push to `main` fell back to `pnpm add wrangler@<ver>` at the root,
  which pnpm rejects in a workspace with `ERR_PNPM_ADDING_TO_ROOT` and the
  deploy step crashed before ever shipping a build. Also simplified the
  workflow to match the working `amio` repo pattern: the Pages project
  name is now hardcoded (`amiclaw`) instead of sourced from a
  `CLOUDFLARE_PAGES_PROJECT_NAME` secret that was easy to leave unset,
  added an explicit `--branch=main` to the deploy command, and dropped
  the unused `gitHubToken` input. Repo secrets shrink from three to two
  (`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`), matching `amio-love/amio`
- **Onboarding** Scene Info bar is now always visible in-game instead of collapsing
  behind an unlabelled chevron on mobile — first-time players no longer have to
  discover and tap a toggle to find the serial number, battery count, and indicator
  lights their AI partner needs. The standard assistant prompt has also been
  rewritten to make reading the full Scene Info bar the explicit opening move
  before any module is attempted
- **Daily mode** `GamePage` now distinguishes "manual not yet published" (404)
  from generic load failures and renders a dedicated fallback that links to
  Practice mode instead of showing the opaque "Could not load manual" retry
- **Repo hygiene** Removed seven stale compiled `.js` shadow files under
  `packages/game/src/{components,store,utils}/` that were silently overriding
  the TypeScript sources at build/test time; the earlier `.gitignore` pattern
  now actually has nothing to re-ignore
- **Planning docs** Superseded the 2026-03-27 remaining-work checklist, which
  listed already-shipped items as open, with a current snapshot dated 2026-04-21
- **CI** Unblocked the main branch lint job after the `eslint-plugin-react-hooks`
  7.x upgrade by initializing `ResultPage` submit state with a lazy `useState`
  initializer instead of a synchronous `setState` inside `useEffect`
- **CI** Allowed `console.warn` and `console.error` in runtime code and included
  `.mjs` in the scripts ESLint override so build scripts no longer trip `no-console`
- **Repo hygiene** Removed three stale compiled `.js` copies of the hook sources
  and ignored `packages/*/src/**/*.js(x)` to prevent accidental re-commits
- **Automation** Added the missing Dependabot labels and removed the repo-wide CODEOWNERS assignment so dependency PRs no longer auto-request `@byheaven` for review

- **Docs** Removed the duplicate AI changelog guide and kept `docs/changelog-style-guide.md` as the single source of truth

<!-- Add every change that will land on main directly below this header. -->
<!-- Entries below are maintained manually -->
