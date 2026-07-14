# Changelog

All notable changes to this project will be documented in this file.
Versions follow [Semantic Versioning](https://semver.org).

## [Unreleased](https://github.com/amio-love/amiclaw/compare/0.1.0...HEAD)

**Your companion breaks the ice** — Added. When another player clears a daily
challenge, joins the streak board, or reaches a streak milestone, your companion
can leave them one congratulatory line on your behalf — posted publicly under
their event and signed as your companion, never as you. The recipient taps once
to have their own companion reply, and the round seals after that single
exchange. Players who don't have a companion yet get a create-a-companion invite
where the reply would go, and you see a dismissible line in your companion dock
telling you what it said, with a link to the thread. Every line is written by the
companion in the moment — nothing is templated, and neither of you types a word.

**The co-build companion now follows through** — Fixed. In signed-in Sound
Garden sessions, the companion could describe planting a piece without changing
the board. Its action output is now a mandatory one-move contract with a concrete
example, the parser accepts the garden vocabulary's Chinese display labels, and
each co-build turn records a bounded action-channel outcome so rejected or
missing action blocks can be diagnosed without logging their contents.

**Sound Garden joins AMIO Arcade** — Added. A new co-build voice game at
`claw.amio.fans/sound-garden`. You plant melody flowers along an 8-beat timeline
while your companion plants rhythm roots on the same beats; a root and a flower
sharing a beat harmonize — synergy, compatible, neutral, or a harsh clash — and
when the harmony score reaches the level's target the garden blooms. Signed-in
players with a named companion co-build by voice: the companion speaks its
guidance AND places its own rhythm roots on your shared board through the new
co_build action channel — its moves pass the same client-side legality guard your
own plants do, and it never moves during its closing recap. Everyone else —
anonymous, no companion, or a standalone build with no platform worker — plays an
offline scripted partner over the browser's own voice, which opens the garden with
a seed move and answers each plant. It is a no-fail sandbox: a clashing pair only
sounds harsh, nothing detonates, and bloom is a reward you can keep playing past.
Ships with three levels, dark-only, CSS-only animation, running on the shared
creation engine.

**The reward economy opens its ledger** — Added. The platform gains an
account-level asset ledger for the earn currency (starburst): append-only
balance records with idempotent crediting and replay-safe daily-cap markers,
plus an authenticated `/api/companion/assets` endpoint that returns the
balance with recent entries and self-heals a one-time +10 welcome grant on
the first authenticated read. Companion-time (voice-session) pricing wiring
lands in a follow-up change.

**Wins and daily check-ins start paying starburst** — Added. Defusing the
BombSquad daily or escaping in Shadow Chase now credits +5 starburst the moment
the run settles, and the first activity you complete each day that counts toward
your streak — a defused daily run or a same-day Oracle sign — adds a +3 check-in
bonus. Rewarded wins are capped at four a day, combined across games; beyond that
a win still settles but earns nothing. The credit is written before the response
returns, so the balance you see is already spendable — the results screen reads
the payout from a new `reward` field on the score and Shadow Chase settlement
responses, and the check-in cue fires from a `checkin_reward` field on the arcade
activity response. Anonymous runs earn nothing, and a replayed run never
double-pays.

**The platform companion learns to act in co-build games** — Added. The voice
AI pipeline gains a backward-compatible action channel: in games flagged as
co-build, the companion's reply can carry one structured board action
(place/remove a piece) alongside its speech, parsed through a bounded splitter
that never leaks protocol markers into the voice and validated against the
game's vocabulary before it touches the board. Existing games are untouched —
the capability is off by default per game, non-co-build replies are
byte-identical, and a barge-in that cuts the companion off also cancels its
pending move. Groundwork for Sound Garden, where the companion plants rhythm
roots in your shared garden.

**Shadow Chase now reads at a glance** — Improved. Setup, tactical planning, the
live chase, and results now use the shared Atlas page, navigation, button, status,
and icon-control grammar. Compact diagrams show that three collected cores open
the moon gate immediately, both shadows must exit, and captures require rescue.
The pursuer strip now reflects deterministic shortest-path pursuit, its switch
from the player to the companion only while the player is captured, contact and
crossing captures, core-earned swaps, and immediate gate unlock. Exact objective,
rescue, and pursuer rules remain available in a collapsed disclosure.

Shadow Chase also registers one bounded moon-blue accent for its title, shadows,
companion, and game-owned ritual graphics. Pursuer and rescue risk use platform
danger, cores and success use platform positive green, and primary actions and
focus stay warm gold. BombSquad rose and Oracle violet no longer leak into the
game.

**Radio Cipher joins AMIO Arcade** — Added. A new voice game at
`claw.amio.fans/radio-cipher`. You are the listener, tuning a static-swept radio
to catch an encrypted transmission by ear; your AI partner (or a friend) holds
the decoder codebook. You type the syllables you hear and report them, and
together you rotate a Caesar-shifted finals cipher back into the answer — neither
side can solve it alone. It ships with two levels (a given-shift tutorial and a
deduction level whose offset you derive by frequency attack), a shareable
codebook page to hand your partner, a per-segment transcription pad, first-run
onboarding, and a count-up stopwatch with a wrong-answer time penalty. Dark-only,
CSS-only animation, running on the shared creation engine.

### Bug Fixes

- **Sound Garden browser verification** — Anonymous co-build checks now advance
  the controlled browser clock through the scripted partner's debounce, so the
  real seed, response, and bloom journey can guard releases without false stalls.

<!-- Add every change that will land on main directly below this header. -->
<!-- Entries below are maintained manually -->

## [0.1.0](https://github.com/amio-love/amiclaw/compare/0.0.0...0.1.0) (2026-07-11)

**AMIO Arcade — play alongside your AI** — AMIO Arcade opens at `claw.amio.fans`:
a co-op arcade where you and a voice AI split the information and solve together.
Four games are live at launch — BombSquad, 双影追逃, 易经签卜, and 植物园养护 —
inside a four-tab home (游戏 / 排行榜 / 社区 / 我的) with daily challenges, a public
leaderboard and streak board, a real community feed, and accounts by email
magic-link or Google.

**A voice AI companion that remembers you** — Signed-in players give their AI
partner a name and a voice, and it stays yours across sessions. It greets you on
the homepage, co-plays BombSquad by voice, keeps a private memory album of the
runs you've shared, and grows more familiar the longer your streak — warming its
tone after a week, marking the 7 / 14 / 30 / 60-day milestones out loud. A 我的
understanding panel lets you see, correct, or switch off what it has learned,
every item tied back to the memory it came from.

**One calm, unified look across the whole arcade** — Every screen — the platform
and its games — now draws from one shared set of components, design tokens, and
the 星图 / Atlas cosmic visual language, replacing the old per-screen copies and
terminal aesthetic. Screens lead with what matters and tuck the fine print behind
a small ⓘ. Dark-only by design.

### Games

- **BombSquad** — The flagship voice bomb-defusal game: you see the bomb, your AI
  reads the manual it can't see, and you defuse by talking. The timer counts up
  from 00:00 — a faster run ranks higher and time never detonates the bomb. The
  daily challenge runs all four modules (光弦 / 星盘 / 按钮 / 星符) under a
  three-strike rule; practice runs two modules, never fails, and draws a fresh
  bomb every time. 「再来一局」 leads the results screen.
- **双影追逃 Dual Shadow Chase** — A two-to-five-minute solo game where you and
  the AI companion collect cores, split up, decoy the pursuer, rescue a capture,
  swap positions, and escape. The pursuer follows only visible world rules with no
  private knowledge, chases your shadow, and each core you collect grants one
  position swap. Chinese-first, with a frozen-map planning phase before the chase;
  deterministic strategy buttons keep every run playable without voice.
- **易经签卜 Yijing Oracle** — Pick two mind-images, cast six coin tosses to draw
  a hexagram, and read the classical texts out to a shareable 卦签 card with a
  vermilion seal. Honest preview: it plays a declared demo cast (卦例演示) over 3
  of the 64 hexagrams with no AI or voice yet — real random casting and a voice
  reading arrive once the full text set lands.
- **植物园养护 Botanical Garden** — A co-op care game: tend a night garden of five
  species as plants decay in real time while your AI companion holds the care
  manual. Two levels ship — a gentle rescue tutorial and a five-plant greenhouse
  shift. Bring every plant to stable with at least one in bloom to win; lose one
  to neglect and the run ends.

### Improvements

**Opening「我的」no longer writes to your account** — Changed. Visiting `/me`
used to auto-save this device's unsaved records into your account on load. Now
that visit is read-only: the「本设备记录」card shows how many records are pending
and you save them with an explicit「保存到账号」tap. Nothing is saved without your
action.

- **Accounts** — Sign in by email magic-link or Google, sign out from 我的, and
  land back in the same account either way. The login page recognizes when you're
  already signed in, echoes the address a link was sent to, states the real
  15-minute single-use validity and 5-per-hour cap, and explains an expired or
  invalid link in plain Chinese.
- **One name across the whole arcade** — Your leaderboard handle, the home
  greeting, and your /me page all show the same name, editable right on /me. Your
  companion's private name for you stays inside the companion instead of leaking
  into the greeting, and you're never greeted by your raw email.
- **Your win goes on the board without the extra step** — Finish a daily run while
  signed in and your score posts automatically under that name — no nickname box,
  no submit button. If you played with the platform voice partner it's recorded
  for you; otherwise the results screen asks once, inline. Not signed in? One calm
  invite to sign in — decline and the run simply stays off the board.
- **A calmer, quieter interface** — Screens lead with the thing that matters and
  tuck the fine print — how the UTC day boundary works, what counts per device,
  longest-streak numbers — behind a small ⓘ you can open when you want it. Copy
  across the hero, daily card, and footer is tightened, and nothing honest was
  removed.
- **Your AI partner is named on the homepage** — The hero names the voice AIs you
  can bring — Claude, ChatGPT, Gemini and the rest cycle through in place — drawn
  from one shared list so the supported tools stay current everywhere at once.
- **The daily rhythm is honest and doesn't vanish** — Daily content follows the
  UTC day, so 「today」 rolls over at 08:00 Beijing time; every daily surface states
  the rule with the rollover rendered in your own timezone, and completion times
  show in local wall-clock time. Yesterday no longer disappears at the reset — the
  leaderboard carries a date switcher back to yesterday, and /me gains a 最近 7 天
  per-day history (打卡 marks, the day's best time, the day's 卦签) for both a
  signed-in account and an anonymous device.
- **A real community feed** — The community page is built from actual play — daily
  defuses, streak-board joins, milestone streaks — instead of fabricated posts.
  Only players on the public streak board appear, by that public name; times stay
  correct as they age, likes stick (sign in to like), and a quiet day says so
  rather than padding the feed.
- **Sound and motion feedback** — Every module action has a short sound and pulse,
  a bright win chime and glyph-burst set apart from the calm failure screen, a
  looping stopwatch tick, and a dedicated detonation boom. All CC0 samples,
  CSS-only animation, dark-only, honoring `prefers-reduced-motion` — with a mute
  toggle saved across sessions.
- **The manual the AI reads, rebuilt** — BombSquad is bring-your-own-AI, so the
  manual is the AI's only source of truth. It now leads with full game framing
  before any rule, reads as one all-Chinese document, names the modules exactly as
  they appear on screen (光弦 / 星盘 / 按钮 / 星符), numbers wires from 1 top-down,
  carries a visual description of every symbol to disambiguate look-alikes, and
  tells the AI to guide rather than guess and never ask the player what a rule
  says.
- **In-game voice co-play** — In BombSquad's daily run, the AI defuse partner runs
  hands-free: it speaks first, you just talk, you can interrupt it, and a clear
  聆听中 / 思考中 / 说话中 status with live 「你：…」 captions shows what it heard. It
  gives one short spoken recap when you win. Signed-in companion owners default
  into playing together, with bring-your-own-AI one tap away.
- **Practice is real practice** — Practice runs the two modules you'll actually
  face (光弦 and 星符), never fails — a wrong answer just retries in place — and
  draws a fresh bomb every run, so replaying is practice instead of answer recall.
  The AI's practice manual carries only those two modules.
- **Easier to tap on a phone** — Back and exit controls are unified to a
  comfortable ≥44px, wire tap areas widened, result-screen buttons brought up to
  size, long nicknames wrapped so the time and attempt columns stay visible, and
  the three-dial 星盘 sized to fit a phone viewport so every control is reachable
  without scrolling.
- **Onboarding for a split-information game** — A first-time player entering
  BombSquad's connect flow sees one short, honest 「怎么玩」 screen — the
  split-information premise, the bring-your-own-AI path, and the platform companion
  behind login — shown once per device and one tap to skip. The scene-info bar
  stays visible in-game, and the button and keypad hint that a hold is possible
  without giving away the answer.
- **Honesty and consistency pass** — A sweep to match every visible promise to
  what the product actually does: BombSquad framed as 「自带任意语音 AI · 例如 …」,
  the login page stating what an account gives you today, dead footer links and the
  weekly-cadence claim dropped, real privacy and terms pages, and every 今日 / 在线
  / 日榜 figure reading the one real board instead of placeholder numbers. The
  product reads as AMIO Arcade throughout, from one shared wordmark and AI-tool
  list; `claw.amio.fans` URLs and internal `amiclaw` identifiers stay in place for
  compatibility.

### Bug Fixes

**Shadow Chase no longer stalls at a sealed or guarded exit** — Fix. The moon
gate now opens on the same simulation tick that the player collects the third
core, with no two-minute minimum. The pursuer has no visibility, patrol, spawn,
or exit state: it always walks a deterministic shortest path to the free player,
switches to the companion only while the player is captured, and switches back
after rescue. Player copy, the map target marker, rescue prediction, voice
context, and the Platform AI rule contract now share that rule. Space is a new
shortcut for consuming one earned position swap.

**Anonymous settlement stops logging a console error** — Fixed. An anonymous
player's win used to leave a single red `401 /api/arcade/profile` line in the
browser console. The identity read now answers a clean `204` (no account to
resolve) instead, so a settlement is error-free end to end. No visible gameplay
change — the anonymous run still stays off the leaderboard and shows the same
calm login invite.

- **Leaderboard integrity** — Each player keeps one row per day showing their best
  time; retries never duplicate or displace it. A 60-second plausibility floor with
  a per-module sanity check filters the board, the homepage 「最快拆弹」 stat, and
  your submitted rank alike, and a refusal reads 「成绩未通过合理性校验」 without
  leaking the threshold. The attempt column is honestly labeled 用时 · 尝试
  (第 N 次), and two devices sharing a nickname read as distinct players with a
  muted 「· 同名 N」 marker.
- **Steady run settlement** — Finishing all four modules with a companion no longer
  flashes a phantom 「模块 5/4」 — the run holds on a 拆除成功 screen through the
  closing recap, then opens results. The companion's spoken line renders once, and
  an anonymous run no longer logs a 401 on settlement.
- **Refresh and deep links recover** — Reloading mid-run, opening a shared link, or
  landing on the results screen directly no longer drops you on a blank or dead-end
  page: BombSquad links open into the game, a mid-run refresh resumes where you left
  off, and recovery screens offer a way back in that keeps your mode.
- **The manual reaches the AI reliably** — The daily run fetches the
  machine-readable YAML (not the HTML page), `/manual/<date>` answers in one hop so
  an AI that won't follow redirects still gets it, typing `/manual/daily` lands on
  today's manual, and once read, the manual stays in the AI's memory for the whole
  conversation.
- **Every date has a playable daily bomb** — Every date for the next year serves a
  daily bomb derived deterministically from the practice rulebook (same date, same
  bomb), and a date with no published manual returns a clean 404 with a 「去练习」
  path instead of a crash.
- **Puzzles are solvable from the manual** — Keypad and symbol-dial rows are
  rebuilt over a wider symbol pool so any set of visible symbols matches exactly one
  row; the dial is communicated as 「按右箭头 N 次」 (an index, never a named
  post-rotation symbol); indicator lights are sampled without replacement so none
  repeats; and a rule that names a color or light not on this board is skipped
  rather than guessed.
- **Sharing degrades gracefully** — Sharing a result or a 卦签 uses the device
  share sheet, falls back to copying, then to a select-to-copy field, and a
  dismissed share sheet counts as a cancel — never a dead-end 「分享失败」. Copy is
  its own action with its own confirmation.
- **Your records follow you** — Signing in saves this device's records to your
  account automatically, the streak board shows your chosen nickname instead of a
  「Player XXXX」 placeholder, and a brand-new companion opens with a first-meeting
  line and counts 「相识 N 天」 rather than implying a history it doesn't have.
- **Colors and names read true** — The community 「拆弹成功」 badge is green, the
  platform's success color, not the cyan reserved for the in-game wire; and every
  AI tool on the leaderboard resolves to its proper display name instead of a raw
  lowercase id.
- **The survey waits its turn** — The 「聊聊这一局」 feedback survey no longer opens
  over your celebration, a near-miss, or a rejection notice; it waits until
  everything has settled.
- **Signed-in pages behave** — Components that load together share a single
  「/api/auth/session」 read, the signed-in homepage drops the anonymous-only device
  caveat, the companion greeting bubble is capped so it clears the daily checklist,
  and turning voice on from a logged-in page away from the homepage actually
  connects.
- **Taps land where you aim** — The decorative ring around the homepage planet no
  longer swallows taps on the 「开始玩」 button's center, the Oracle image-picker no
  longer clips its third column on narrow phones, and the login page's 「直接开始玩」
  escape link is no longer hidden behind the tab bar.
