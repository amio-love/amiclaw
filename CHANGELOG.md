# Changelog

All notable changes to this project will be documented in this file.
Versions follow [Semantic Versioning](https://semver.org).

## [Unreleased](https://github.com/amio-love/amiclaw/compare/0.0.0...HEAD)

### Improvements

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

### Fixed

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
