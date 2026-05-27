# Changelog

All notable changes to this project will be documented in this file.
Versions follow [Semantic Versioning](https://semver.org).

## [Unreleased](https://github.com/amio-love/amiclaw/compare/0.0.0...HEAD)

**AmiClaw platform homepage** — The site now opens on a full AmiClaw
platform homepage instead of a bare BombSquad launcher. A four-tab shell
(游戏 / 排行榜 / 社区 / 我的) frames the「星图 / Atlas」design: a signed-out
visitor lands on a hero with a live daily-challenge countdown, a featured
BombSquad section, and previews of upcoming games and the community feed,
while a signed-in visitor sees a personal welcome strip in the hero's
place. The existing BombSquad game flow is unchanged and stays reachable
straight from the homepage CTAs.

### Changed

- **BombSquad landing and connect screens get the Atlas look** Entering
  BombSquad from the homepage now opens BombSquad's own landing page in the
  「星图 / Atlas」cosmic style — a floating planet hero, the BOMBSQUAD
  wordmark, a live daily-reset countdown, and separate 每日挑战 / 练习 CTAs.
  Picking a mode opens a three-step connect-AI flow — copy the manual link,
  switch the AI to voice mode, then a breathing "ready" pulse — that replaces
  the old single copy-prompt modal before handing off to the run. The
  platform homepage's BombSquad CTAs route to this landing page instead of
  straight into a run; the daily / practice choice and the manual-link
  handoff to the AI partner are unchanged in substance. The connect flow's
  first step also carries forward the discovery link to the voice-AI
  compatibility guide that the old modal held, so players unsure which AI to
  use can still reach the supported-tools page.
- **BombSquad in-run screens get the Atlas look** The four puzzle modules and
  the screen around them — timer, module label, scene info, and progress — are
  reskinned from the old terminal aesthetic to the「星图 / Atlas」cosmic visual
  language: a deep-space gradient, glass panels, glowing glyphs, and the
  AMIO-yellow accent. The dial becomes a row of glowing astrolabes, the wires
  become glowing light strings, and the keypad becomes a tappable
  constellation; the modules are renamed 星盘 / 光弦 / 星符 to match. Puzzle
  rules, timing, and difficulty are untouched — only the presentation changes.
- **BombSquad result screens get the Atlas look** The end-of-run screens are
  rebuilt in the「星图 / Atlas」cosmic visual language to match the rest of the
  game. A cleared run shows a green star-burst, a 拆弹成功 banner, the run
  time, global ranking, and a per-module breakdown; a run that fell short
  shows a rose ripple, a gentler 差一点 banner (replacing the old 拆弹失败 /
  时间到 wording), an AI consolation note, and a this-run review that marks
  where the run stopped. The four puzzles read by their Atlas names
  (光弦 / 星盘 / 按钮 / 星符) on the result page and in the copyable recap. The
  copyable plain-text summary and the replay flow are unchanged.
- **BombSquad redesign accessibility pass** The reskinned BombSquad screens
  get a keyboard and focus polish. Every control — dial knobs, light
  strings, constellation stars, the press-and-hold button, and all CTAs —
  is now fully operable from the keyboard and shows a clear yellow focus
  ring when tabbed to. The game landing screen's top-right control now uses
  an exit icon instead of a settings gear, so it matches what it does:
  leaving the game for the AmiClaw homepage.
- **Daily challenge now has real stakes** The daily timer counts down from a
  10-minute budget, and a wrong answer finally costs something: three
  mistakes across the run — or letting the countdown hit zero — detonate the
  bomb with a full-screen explosion and a dedicated failure result page. The
  first two strikes show as a visible pip counter so the pressure is legible.
  A wrong answer no longer silently reshuffles the module — the puzzle stays
  put and you retry it in place — and only a successful defuse posts to the
  leaderboard. Stored completion times and ranking are unchanged.
- **Practice mode is now a real on-ramp** Practice is no longer a shrunken
  daily run. It runs just two modules (wire and keypad) and never fails: a
  wrong answer just lets you retry the same puzzle in place, and running out
  of its 5-minute countdown ends the session gently with a "modules
  completed" recap instead of an explosion. There is no in-game tutorial
  screen — learning the ropes is what your AI partner is for.
- **Louder wrong-answer feedback** A wrong answer now pulses a bold red
  border around the whole module panel, so a mistake is obvious at a glance
  in both daily and practice mode — not just a faint flash inside the puzzle.
- Replace the 6-character serial code in the SceneInfoBar with a Chinese
  tongue-twister phrase ("暗号"). The player now reads the phrase aloud to
  the AI partner — pronouncing it correctly becomes a small in-game challenge.
  The unused `serial_last_digit` / `serial_has_vowel` derived rule-engine
  context and the matching `simon_says` decoy block in `practice.yaml` and
  365 daily manuals are removed alongside.

### Added

- **Endgame survey** After any game ends — win, loss, timeout, practice or
  daily — the result page now shows a one-time, four-question survey: which AI
  tool you played with, how fun and how hard the run felt, and an optional
  free-text note on the biggest problem working with the AI. It rides inside
  the existing post-game modal instead of stacking a second dialog: on a first
  daily win the nickname prompt and the survey share one modal. The survey is
  always optional — it can be skipped, and confirming the merged modal needs
  only a valid nickname — and it appears just once per device. Answers are
  POSTed to `/api/events` and surface in the beta data dashboard. Source task
  `add-amiclaw-endgame-survey`.
- **BombSquad gets its own landing page and a connect-AI on-ramp** Choosing
  BombSquad from the homepage no longer drops straight into a run. It now
  opens a dedicated BombSquad landing — a glowing planet hero, a live
  daily-reset countdown, and 每日挑战 / 练习 CTAs — followed by a three-step
  「对接 AI」flow that walks the player through copying the manual link to
  their AI, switching it to voice mode, and a breathing "ready" beat before
  the run begins. Both screens are built in the「星图 / Atlas」cosmic visual
  language.
- **PR preview deployments** Every pull request against `main` now builds
  the site and deploys it to a Cloudflare Pages preview, then posts the
  preview URL back to the PR as a single sticky comment that updates in
  place on each later push. Reviewers can open the link on any device —
  including a phone — to play-test the PR's exact build before it merges.
  Source task `setup-amiclaw-pr-preview-deployments`.
- **Leaderboard nickname prompt** First time a player finishes a daily
  challenge, the result page asks for a nickname (max 20 chars) before posting
  the score. The value is stored in localStorage and reused on every later
  daily run from the same device, so the leaderboard finally shows recognisable
  names instead of a wall of "Anonymous". The prompt is required — submission
  is blocked until a valid nickname is entered — and there is no edit-later
  entry point in this release. Source task `add-leaderboard-anonymous-handle`.
- **Voice AI compatibility reference** A new `/compatibility` page lists the
  voice AIs that have been verified against the bomb (Claude today, with
  ChatGPT and Gemini placeholders inviting player feedback) and surfaces a
  ready-to-copy opening prompt the player can read to their AI partner before
  handing over the manual URL. The prompt modal now carries a small "不确定用
  哪个 AI？查看支持工具" link directly under its send-to-AI tip so the
  reference is one click away from the moment the question typically arises.
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
- Beta data dashboard at `/api/dashboard?token=xxx` showing daily game_start/complete/replay counts and completion rates against the 70%/50% north-star thresholds. Requires `DASHBOARD_TOKEN` Pages secret (set via `wrangler secret put DASHBOARD_TOKEN`).
- `game_failed_strikeout` / `game_failed_timeout` telemetry events — a
  daily challenge that detonates now emits one of two failure events that
  distinguish the loss cause: three cumulative strikes (strike-out) versus
  the countdown reaching zero (timeout). The beta data dashboard gains two
  raw-count columns showing the per-day failure-mode split. Telemetry-only
  with no player-visible change; practice mode never fails and emits
  neither event.
- **Mute toggle** The game's top bar now has a mute button that silences every
  sound effect. The setting is saved to localStorage, so the game stays muted —
  or un-muted — across page reloads and later sessions.
- **CI** Added a `typecheck` step that runs the `api` package's `tsc --noEmit`
  via a new root `pnpm typecheck` aggregate script, so type errors in the
  leaderboard API now fail CI instead of merging silently.
- **CI** Added an end-to-end test harness that runs as two new per-PR
  checks. The `e2e` job builds the site and drives full BombSquad
  play-throughs in a real browser with Playwright + playwright-bdd, under
  a pinned fake clock so every daily run is deterministic and exactly
  reproducible. The `e2e-audit` job reconciles the Gherkin scenario suite
  against the `e2e/flow-inventory.yaml` flow registry — a missing,
  orphaned, duplicated, or untagged flow fails the build — and regenerates
  the golden `answers.json` fixture so a puzzle-generator change that would
  silently invalidate it is caught loudly.
- **E2E dual-agent simulation layer** The second layer of the e2e
  governance model. Six `@simulation` collaboration-usability scenarios
  under `e2e/simulation/` — the four BombSquad modules in isolation plus
  full practice and daily-challenge runs — drive an LLM-based dual-agent
  test harness, where a player agent that only sees the screen and an
  assistant agent that only reads the manual collaborate to defuse the
  bomb. This layer is LLM-driven and run on demand; it is never a CI
  check or a merge gate. A non-blocking `simulation-reminder` CI job
  flags pushes touching `packages/game/` or `packages/manual/data/` as
  candidates for a simulation run. Source task
  `implement-e2e-dual-agent-simulation`.

### Improvements

- **Bomb detonation sound** Failing a daily challenge now fires a dedicated
  explosion sound effect under the full-screen detonation overlay — a sharp,
  prominent boom — replacing the muffled module-failure thud reused as a
  placeholder until now. The sample is a new CC0 asset from Kenney Sci-Fi
  Sounds; no new runtime dependencies.
- **Beta data dashboard TTL** Event-ingestion KV TTL extended from 48 hours
  to 30 days so the dashboard can show the full 5/18→5/31 internal-beta
  window cumulatively. Leaderboard KV TTL unchanged (still 48h).
- **Landing first impression** The home page now leads with the four-step
  "怎么开始" guide above the practice / daily CTAs, so visitors arriving from
  a cold-shared link see the voice-AI partner is a prerequisite before they
  tap a button. The four how-to lines are concise and follow the order
  players actually work in — copy the manual link on the page first, then
  open the voice AI and send it the link. A new `≤480px` mobile
  breakpoint stacks the CTAs vertically with full-width buttons, tightens the
  BOMBSQUAD title letter-spacing, and aligns home-page padding so 320 / 375 /
  414 viewports no longer overflow.
- **Failure-state guidance** Four failure surfaces in the daily flow now
  point players toward a recovery path instead of dead-ending. A corrupted
  manual is recognized as a parse error and surfaces "手册格式异常，请截图邮件
  反馈给 <byheaven0912@gmail.com>" instead of the previous misleading
  "check your network" prompt. Network drops show "加载失败，请检查网络或换
  Chrome / Safari 试试。一直失败可邮件反馈" alongside a retry button. The
  leaderboard error state, previously a static "排行榜暂不可用，稍后再试。",
  now exposes an inline 重试 button plus the same feedback hint. And a
  result-page repeat-submit failure no longer leaves a blank screen — it
  shows "网络不稳定，可下次再来重新提交。或邮件反馈" so players know the
  run isn't lost on our side.
- **Test runner self-containment** Internal refactor — `packages/manual` now
  has its own vitest setup, and the cross-SSOT character-equal guard tests
  (manual yaml symbols matching `shared/symbols.ts`) live in the manual
  package alongside the data they test. The game-package test file is back
  to schema-unit only, and root `pnpm test:run` runs both packages via
  `-r run` (CI inherits automatically).
- **Daily-manual drift guard** Internal refactor — a new test in
  `packages/manual` fails CI whenever a committed `data/daily/*.yaml` no longer
  matches what the generator derives from the current `practice.yaml`, so
  editing the practice rulebook without regenerating the daily manuals can no
  longer drift silently into production.
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
- **Recap personal-best and retro questions** Result-page copy summary now
  includes a `今日最佳：MM:SS（第 N 次）` line in daily mode (sourced from the
  KV personal-best record returned by `/api/scores`) and replaces the single
  trailing prompt with three contextual retrospective questions produced by
  `buildRetroQuestions`. The first question names the slowest module (and
  its reset count, when any); the second asks for a smooth-vs-stuck moment
  or, on a 2nd+ daily attempt, invites a comparison to earlier attempts;
  the third closes the loop on the skills file. Format ordering now matches
  MVP §5.3 exactly: 总用时 → 今日最佳 → 全球排名 → 模块详情 → 三问. Legacy
  KV records pre-dating the `attempt_number` field gracefully render
  `今日最佳：MM:SS` without the suffix; practice mode skips both
  `今日最佳` and `全球排名` but still gets the three-question block.
- **Attempt-label wording aligned with MVP §5.3** Daily-mode attempt labels
  on the result page and in the copyable recap now say `第 N 次尝试` (with
  `尝试`) instead of `第 N 次` (without). Touches the result-page meta line,
  the copy-summary `modeLabel`, and `buildRetroQuestions` Q2 — bringing
  these three surfaces in sync with spec §5.3 line 478 / 493. The
  personal-best line `今日最佳：MM:SS（第 N 次）` keeps its existing
  no-`尝试` form, matching spec §5.3 line 482's example.
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
- **Spark-highlight wire cut** Cutting the correct wire now plays a reworked
  success animation — a quick spark flash at the cut point, a brief glow on
  the two severed ends, and the halves snapping apart fast. It is pure CSS,
  and the reduced-motion fallback keeps both halves visible without motion.
- **Clearer Scene Info bar** The indicator lights now have their own
  "指示灯：" label, and a divider separates them from the battery count.
  Previously the indicator chips sat flush against "电池：N" with no label of
  their own and were easy to misread as battery symbols.
- **Sharper AI partner guidance** The bomb manual now explicitly tells the AI
  what it must not say to the player — no raw rule text or condition tables,
  no hints that decoy modules exist, no manual structure — and to reply with
  the conclusive action only, never its reasoning. The same two guardrails
  are added to the standard AI prompt.

### Fixed

- **Wire module manual gains a rule preamble** The wire_routing section
  gains a natural-language `rule:` preamble that spells out
  first-match-wins, that integer `position` is 0-indexed top-down, the
  equivalence `first ≡ position 0` and `last ≡ position length-1`, and
  that the `target.color` field is a stronger color filter rather than
  a position override. Without the preamble an AI partner could only
  guess the indexing base and the match order and would sometimes
  translate "cut the bottom wire" into the wrong position, leading
  players to cut the wrong wire. The change propagates through the
  seeded shuffler to all 366 daily manuals.
- **Button module manual gains a rule preamble** The button section
  gains a natural-language `rule:` preamble that spells out
  first-match-wins, the meaning of each condition dimension
  (color / label / battery_count / indicator_FRK_lit), and what
  `{ type: 'tap' }` and `{ type: 'hold', release_on_light }` each ask
  the player to do. Without the preamble an AI partner would give
  conflicting instructions whenever multiple conditions could match,
  and the player could not tell whether to tap or hold.
- **Keypad un-tapped symbol contrast restored** After the 星图 / Atlas
  redesign the keypad module set un-tapped symbol strokes to 50%
  transparent white, which was nearly unreadable on the dark
  constellation backdrop and made players describe symbols incorrectly.
  The stroke is restored to the fully opaque `var(--color-text-primary)`,
  bringing back the high-contrast read-the-glyph experience from before
  Atlas. The tapped-state yellow glow is unchanged.
- **trident symbol description corrected to match the actual glyph**
  The trident description in `shared/symbols.ts` previously claimed the
  two top arcs connect the "left–center" and "center–right" inner
  spikes, which disagrees with how the SVG is actually drawn — the
  real glyph has a long center vertical, a medium vertical on each
  side, and a shorter vertical further out, with top arcs sweeping
  outward from the inner-spike tops to the outermost short verticals.
  The rewritten description now matches what the player actually sees.

- **Keypad and symbol-dial puzzles are solvable from the manual again**
  Both modules listed several manual rows — keypad sequences and dial
  columns — built from one shared symbol set, so the rule "find the row
  containing all your visible symbols" had no unique answer. An AI
  partner reading the manual could not tell the player which row to use,
  and players who drew the keypad or symbol-dial module got stuck. The
  keypad sequences and symbol-dial columns are rebuilt over a wider
  symbol pool so any set of visible symbols now matches exactly one row,
  and all 366 daily manuals are regenerated to match. The modules play
  exactly as before — only the underlying symbol sets changed.
- **Atlas-consistency leftovers from the BombSquad redesign** A small
  cleanup pass clears the last traces of the old terminal look downstream
  of the redesign. The community feed's two sample run-result cards now
  read 拆弹成功 / 差一点 to match the result screens, in place of the retired
  DEFUSED / EXPLODED wording. The AI-compatibility page's "返回 BombSquad
  首页" link now actually lands on the BombSquad landing page instead of the
  AmiClaw platform homepage, so the link text and where it goes finally
  agree. The nickname dialog and the AI-compatibility page also switch from
  the retired CRT-cyan accent to the AMIO-yellow brand accent, so every
  screen shares one palette.
- **Mobile beta-flow polish** A pass over the phone experience makes the
  daily beta path easier to use. Small text links and buttons that sat
  below a comfortable finger size — the home page's leaderboard link, the
  prompt dialog's close button and AI-compatibility link, the result
  page's leaderboard / home links and its submit-retry button, and the
  leaderboard's back-to-home link — now have full 44px tap areas, with no
  change to how they look.
  The in-game 暗号 code phrase you read aloud to your AI partner, the
  result page's module-time table, and the in-game exit button label no
  longer render below 14px, so they stay legible on small screens. The
  in-game exit button is no longer
  narrower than it is tall, and the prompt and nickname dialogs gain a
  scroll fallback so a short landscape viewport can no longer clip their
  content with no way to reach the rest. The in-game error screens'
  "← 返回首页" link also picks up the styling it was silently missing.
- **Wires are easier to cut on a phone** Tapping a wire in the first game
  module used to demand near-pixel accuracy on a narrow screen — the
  clickable strip along each wire was under half the recommended touch
  size, so a slightly-off tap cut the wrong wire and reset the module. Each
  wire's tap area is now widened as far as it can go without overlapping the
  next wire's, so cutting the wire you aimed at is far more forgiving on
  mobile. The wires themselves look exactly the same.
- **Leaderboard stays readable with long nicknames** A daily player can
  legally pick a 20-character nickname with no spaces — an unbroken English
  handle, for example. Such a nickname used to stretch the leaderboard's
  nickname column wide enough to push the time and attempt columns off the
  right edge on a narrow phone, where the page's overflow guard clipped them
  with no way to scroll across. The nickname column now wraps long handles
  onto multiple lines, so the time and attempt counts stay visible at any
  viewport width.
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
- **Indicator lights no longer repeat** Indicator lights could appear twice in
  the same bomb (for example two "SND" chips), which also corrupted the
  rule-engine state for that indicator since same-named lights overwrote each
  other. Indicators are now sampled without replacement, so every indicator in
  a bomb is unique.

<!-- Add every change that will land on main directly below this header. -->
<!-- Entries below are maintained manually -->
