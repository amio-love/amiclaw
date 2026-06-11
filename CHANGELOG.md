# Changelog

All notable changes to this project will be documented in this file.
Versions follow [Semantic Versioning](https://semver.org).

## [Unreleased](https://github.com/amio-love/amiclaw/compare/0.0.0...HEAD)

**Google sign-in** - You can now sign in with Google as well as by email magic
link. The `/login` page shows a "用 Google 登录" button that takes you to Google's
consent screen and back; signing in with Google lands you in the same account as
the email magic link for the same address (one identity, one session). The flow
verifies an anti-CSRF `state` token on the way back (single-use, short-lived),
exchanges the authorization code for the Google identity server-side, and
rejects an unverified Google email. Sign-in events are written to the audit log,
same as the email path. The session cookie and revocation behave exactly as for
the magic link — Google only changes how your email is proven, not how the
session works. See `functions/api/auth/PROVISIONING.md` for the one-time Google
Cloud OAuth app setup (`GOOGLE_OAUTH_CLIENT_ID` + `GOOGLE_OAUTH_CLIENT_SECRET`
and the authorized redirect URI).

**The BombSquad first-run path no longer depends on clipboard permission** —
If the browser refuses to copy the manual link, the connect screen now says so,
keeps the manual URL visible, and lets the player continue after manually
sending it to their AI. The visible manual URL card is now also a click target
for the same copy action as the primary button. The post-game survey waits
until the success feedback has had time to land, instead of covering the first
clear immediately. The mobile BombSquad lobby also keeps its top chrome inside
the viewport, and the button and keypad modules expose shorter, more useful
accessible labels for the state a player needs to describe.

**Magic-link sign-in backend (server side)** - AmiClaw now has a real,
revocable sign-in backend for the paid (platform-AI) path. A player enters
their email at `/api/auth/magic-link/request`, receives a one-time link by
email (sent via Resend), and lands on `/api/auth/magic-link/verify`, which
creates an opaque server-side session and sets a secure session cookie.
`/api/auth/session` reports who is signed in and `/api/auth/logout` revokes the
session. The one-time token is single-use and expires within 15 minutes, the
server stores only its SHA-256 hash (never the plaintext), the request endpoint
returns the same response whether or not the email is known (no account
enumeration), send and verify are rate-limited, the cookie is
HttpOnly + Secure + SameSite=Lax, and sign-in / sign-out / verify events are
written to an audit log in a dedicated `AUTH` KV namespace. Leaderboard score
submissions now reject any request that claims a `user_id` without a valid
session; anonymous device-UUID submissions are unaffected. See
`functions/api/auth/PROVISIONING.md` for the one-time setup (Resend key + `AUTH`
namespace).

**Magic-link sign-in UI, wired to the real session** - The site now reads the
real sign-in state from the server instead of a development mock. A new
`/login` page takes an email and sends the magic link; after you submit it
always shows the same "如果该邮箱可用，你会收到一封登录邮件" message, so the page
never reveals which addresses have an account. The 登录 entry points (top
navigation and the account page) route here. The account page
and home page now show your real identity once you are signed in: your name is
derived from your email, and because per-user stats are not built yet, signed-in
pages show an honest "还没有成绩，去玩一局" empty state rather than placeholder
numbers. The old `?auth=in` URL mock is gone from the shipped site; a
development-only sign-in shortcut remains for local work and is compiled out of
the production build.

**Games can now plug in a shared AI voice partner** — AmiClaw gains a reusable
platform AI layer (`@amiclaw/platform-ai`) so any game can hand the player a
voice partner instead of building one from scratch. It runs a modular
speech-to-text → language-model → text-to-speech pipeline behind one
game-agnostic session contract; the model reads only the manual the platform
injects for the current step, so it guides without inventing rules. DeepSeek and
Volcengine (火山) are the default providers, and switching a vendor is a config
change, not a rewrite. The session lives in a per-player Durable Object over a
same-origin WebSocket, bound to the signed-in player; provider keys and the
system prompt stay server-side and never reach the browser. A first-party demo
harness runs the whole speak-to-reply loop locally with deterministic mock
providers — no real credentials needed.

**The home page now introduces AmiClaw as a platform, with one BombSquad block** - The
hero description now explains AmiClaw instead of describing only the defusal game, and
the hero keeps a single start button. The former daily challenge and weekly feature
sections are merged into one BombSquad overview with a daily countdown and no repeated
leaderboard data. The card also uses tighter copy, drops the four-module and daily-same
labels, expands the AI tool list to Claude, ChatGPT, Gemini, Openclaw, Hermes, Doubao,
Qianwen, and DeepSeek, and updates the footer pitch to the bring-your-AI message without
the old free/no-archive subtitle.

**The hero planet stat now counts live games instead of AI tools** - The floating stat
pill now shows two live games, covering BombSquad and the Yijing Oracle preview, instead
of showing the old supported-AI-model count.

**四个品牌元素现在全站只有一种长相** — 同一个名字、同一个标志，过去在首页、BombSquad
大厅和平台导航里各画各的，凑在一起显得没收尾。现在它们都收敛到一套共享组件：产品名在正文里
统一写作 AmiClaw;BombSquad 标志一律是白色 BOMB 配亮黄 SQUAD 的横排,首页那版刺眼的
青色竖排不再出现;支持的 AI 工具固定写成 Claude · ChatGPT · Gemini,同一种间隔、同一种
字重;每日重置倒计时在大厅也补上了「时 分 秒」标签,和首页每日卡片完全一致。首页主视觉那颗
星球此前也是一身青光,现在跟 BombSquad 大厅的星球统一成暖黄配紫的宇宙色;首页「本周聚焦」
那张卡片残留的青色氛围也一并清掉。还有几处小标签过去会把名字顶成全大写:大厅顶部把支持的 AI
写成 CLAUDE、CHATGPT、GEMINI,「关于」那栏把产品名写成 AMICLAW;现在它们都回到正确的
大小写,固定写作 Claude · ChatGPT · Gemini 与 AmiClaw。

**The home page now says one thing about how to start, and says it
honestly** — The landing page used to describe your AI partner as your eyes or
your ears, which gets the game backwards: you are the one looking at the bomb,
and the AI is the one reading the manual. The daily-challenge and featured
sections now say it straight — you describe the panel, the AI looks it up in
the manual. And the five different buttons that all led to the same place are
down to two, both reading「开始玩」, so it's obvious where to go to start a game.
The daily and featured cards are now plain info cards, and the footer is a plain
pitch — none of them tries to send you off with its own button anymore.

**页脚不再留两个点不动的死链接** — 页脚里的「关于」和「Discord」过去只是两段不能点的
文字。「关于」没有对应的页面,直接拿掉了。「Discord」改成接上社区邀请链接:邀请链接填好
之前它不出现,填好之后就变成一个能点、在新标签页打开的入口。隐私和条款两个链接照常可用。

**Game Lab 区块准备好接上 Discord** — 落地页的 Game Lab 区块写着「在 Discord 写下你
想和 AI 一起玩的小游戏」,现在这块卡片可以变成真正能点的 Discord 入口:填上邀请链接后,
卡片就带上「加入 Discord」的提示、点一下在新标签页打开邀请。在链接配置好之前,卡片和原来
一模一样、不可点,所以这次改动对你看到的页面没有任何影响。

**Practice mode hands your AI only the two modules you'll play** — In practice
you only ever face the 光弦 and 星符 modules, but the manual your AI partner reads
still listed all four. If you misspoke or the screen hiccupped, the AI could
confidently walk you through a 星盘 or 按钮 step that a practice run never shows.
The practice manual now carries only the 光弦 and 星符 rules, so your partner stays
on the two modules in front of you. Daily challenges are unchanged — they still
use all four.

**The small labels on the home page are easier to read** — The little tags
around the landing page — the section eyebrows, the orbit-stat captions, the
status and preview badges, the daily-challenge countdown units, the featured
leaderboard's column headers, and the returning-player welcome line — used to
sit at 10–11px, which left the Chinese ones cramped and hard to read, and on
phones some of them shrank even further. They now all render a notch larger so
the text is comfortable to read everywhere, including on mobile. Nothing moved
or changed color; the labels are just bigger.

**进入游戏，直接开局，少点一次** — 对接 AI 的最后一步现在多了一句提醒：等你的 AI
读完手册说「好了」，点「进入游戏」就开始，计时也随之启动。点下去就直接进入这一局，
不再跳出一块「准备好了吗？」的黑屏让你再确认一次。该确认 AI 的提示，正好出现在你
设置 AI 的那一页。

**The homepage is calmer and easier to read** — The fabricated community feed
at the bottom is gone — those posts were made up, so there was nothing real to
show. The featured BombSquad section no longer stacks two extra play buttons on
top of its header link; it now has a single「游戏页」link, so you're not staring
at the same destination three times. And the copy across the hero, daily
challenge, and footer is tightened, with a clearer hierarchy so the first thing
you read is what Amiclaw is and how to start playing.

**The wire manual now numbers wires the way your AI partner talks** — In the
光弦 module the manual used to number wires starting from 0, so the AI had to
silently translate "position 0" into "the first wire from the top" every time it
read you a cut — a quiet off-by-one waiting to happen. The manual now numbers
wires from 1 top-down, so "position N" reads as exactly「从上数第 N 根」, the same
words the AI says out loud. The correct wire to cut is unchanged on every board;
this only removes a translation step that could trip the AI up.

**The 星盘 now shows how many right-arrow presses you've dialed in** — Each of the
three dials used to leave you guessing whether you'd turned it the right amount,
with only the shifting center symbol to go on — which isn't the answer. Every dial
now carries a live「右拨」counter, and a line above the dials reminds you it's the
number of right-arrow presses that matters, not the symbol in the middle. So when your
AI says「按右箭头 3 次」, you just turn until the counter reads 3. The left and
right buttons also swapped their old swirl icons for plain left / right arrows, so
there's no doubt which way each one turns. The puzzle and its answers are exactly
the same.

**The button's light now visibly keeps cycling, so you don't let go too early**
— On the button module, holding the button runs its little light through a
sequence of colors, and you're meant to release on one specific color. The
light could look like it had simply settled, so it was easy to let go on the
first color you saw and take a strike. Now a thin ring sweeps around the light
and it pulses on every change, making it obvious the colors are still cycling —
wait for the one your AI told you and release then. The colors and timing are
unchanged, and the cue gives away nothing about which color is the right one.

**There's now a real privacy policy and terms page** — The 隐私 and 条款 links
in the footer used to be dead text. They now open proper pages that spell out
exactly what we collect (your nickname and chosen AI tool go on the public
leaderboard; an anonymous device id and game events; an optional survey), how
long we keep it, and how to ask us to delete it — so you can see what happens to
your data before you play.

**「我的」no longer shows a stranger's stats before you have any of your own** —
Opening「我的」used to greet every visitor with a complete profile — 42 games
cleared, a 6-day streak, a wall of badges — that belonged to someone who wasn't
you, sitting right under the line「所有数据只属于你」. Before you have a profile of
your own, the page now shows a clean prompt and a preview of what your 星轨 will
hold — your record, streak, and badges — instead of another player's numbers.

**The Yijing home no longer shows a settings button that does nothing** — The
gear icon in the top corner of the 易经 oracle home looked tappable but had
nothing behind it — there are no settings to open. It's gone now, so every
control on the page does something.

**The top-right button does something now, and no button lies about signing up**
— The yellow「登录 / 开始」button in the top-right corner used to do nothing when
tapped, which made you wonder what else on the page was just for show. There's
never been a login or a sign-up here — you just play — so that button now reads
「开始玩」and takes you straight into a game.

**Your AI no longer guesses a wire cut it can't pin down** — On one rare wire
layout, the manual could point your AI at a wire color that wasn't on the
board, leaving it to improvise — and a guess there could cost you a strike. The
manual now only ever names a wire your AI can actually find, so it always has a
definite cut to tell you. The puzzles and their answers are exactly the same;
your AI just never gets cornered into a guess.

**Your AI no longer gets stuck on a light that isn't in this round** — Some wire
and button rules hinge on an indicator light like FRK, and that light only shows
up in some rounds. When the round didn't have it, your AI could stall — asking
over and over whether it's lit — or assume it was on and follow the wrong rule.
The manual now tells your AI that a named light missing from the round counts as
off, so it moves on to the rule that actually applies instead of getting stuck.
The puzzles and their answers are exactly the same.

**When two star-panel symbols look alike, your AI can point you by grid cell** —
A few of the star-panel symbols are easy to mix up by name — the three-prong
trident and the bowl-and-stem beside it, or the hourglass and the triangle. If
you couldn't tell your AI which was which, "tap the trident" could land on the
wrong cell and cost you a strike. Now, whenever a look-alike pair is on the
panel, your AI can switch to pointing by position — "tap the top-left one" — so
a confusable pair never turns into a wrong tap. The puzzle itself is unchanged;
your AI just has a surer way to tell you which cell it means.

**The big button on the connect screen now actually copies the manual** — On the
first step of handing the manual to your AI, the largest, brightest button at the
bottom used to do nothing until you found a smaller card above it — so a first tap
felt like the screen had frozen. That button is now the real action: tap「复制手册」,
it copies the link, turns green, and moves you straight to the next step. The link
still shows above it so you can see exactly what gets sent.

**The dark wire is finally readable** — The darkest of the six wires used to all
but vanish into the panel, so "cut the black one" turned into a guessing game.
Every wire now sits on a thin light casing that lifts it off the background, so
all six colors read at a glance and the dark wire stays clearly the dark
one — no hue lost, just visible now.

**Refreshing or sharing a game link no longer lands on a blank page** —
Reloading mid-run, opening a bookmark, or following a link a friend sent you
used to drop you on an empty platform screen instead of the game. Now those
links open straight into BombSquad, and a mid-game refresh picks your run back
up where you left off.

**The results screen is no longer a dead end** — Opening the results screen
directly, or landing on it after a refresh, used to show "暂无数据" with only a
link back to the home page — a dead end that pushed you out of the game. It now
greets you with a way back in: 开始今日挑战, 练习一局, or 返回主页, so you can
jump straight into a run instead of starting over from scratch.

**The numbers you see are now real** — The homepage, the BombSquad landing,
and the leaderboard used to show placeholder figures — a "本周在线" count, a
"最快拆弹" time, a mini board of made-up players — that had nothing to do with
the actual daily leaderboard. Now every "今日 / 在线 / 日榜" figure reads the
one real daily board: when today has no scores yet, you see an honest empty
state ("今日还没有成绩，来抢第一！") and a zero count instead of invented
numbers. The leaderboard page drops the 本周 / 本月 / 历史 tabs, which were
never backed by any real aggregation, and keeps just the 每日 board. The Yijing
home no longer shows a fake "已问卦" counter either.

**The trident symbol finally looks like a trident** — One of the star-panel
symbols used to draw a muddled shape — a pole with two little hooks — that
matched nothing you could put into words, so describing it to your AI led
nowhere and it was easy to mix up with the bowl-and-stem symbol next to it.
It's now a clean three-prong trident: three separate spikes on a crossbar with
a handle running down. Describe what you see and your AI lands on the right
symbol the first time.

**Leaderboard rows now remember who you played with** — When you clear the
daily challenge, the result screen now asks which AI assistant helped you and
lets you add an optional model name. Your leaderboard row shows that AI context
next to your time, so friends can compare Claude / ChatGPT / Gemini + model
runs instead of just names. Chinese nicknames also survive the save path now,
so names like 小明 stay visible instead of turning into Anonymous.

**Your AI partner now calls the modules by the names you see** — The manual
used to name the puzzles by old internal labels, so when you said "光弦" or
"星符" your AI had never heard of them and stalled on your very first sentence.
The manual now uses the exact names on your screen — 光弦, 星盘, 按钮, 星符 —
so the two of you start on the same page.

**Your AI stops chasing the decorative bits of the scene row** — The 暗号
phrase at the start of the scene info row is just flavor — no rule ever uses
it — yet your AI used to ask you to read it out and even echo it back, and
the game nudged you to recite the whole row. Now the prompt to read the row
points only at the parts that matter (battery count and indicators), and your
AI treats the 暗号, any indicator a rule doesn't name, and the button's preview
color and display number as background it can safely ignore — so it asks you
for less and never matches a rule against something that doesn't count.

**The clock is now your score, not a fuse** — The timer counts up from 00:00
instead of ticking down, and running long no longer blows up the bomb. In the
daily challenge a faster run simply ranks higher on the leaderboard, so you can
take the time to talk things through with your AI — ask for a second look,
clear up an uncertain symbol — without a deadline detonating the bomb mid-
sentence. The only way a daily run ends in failure is three wrong answers.
Practice stays as gentle as ever. The timer also drops its old red
"running-out" warning, since there's nothing left to run out of.

**The manual reliably reaches your AI — and stays in its memory** — Some
AI partners couldn't open the manual link at all: the page quietly bounced
them with an empty redirect and they gave up with nothing to read. That
page now answers in one hop, so even an AI that won't follow redirects gets
the full manual. And once your AI has read it, it keeps the manual in mind
for the whole conversation instead of re-opening the link every turn — less
waiting between your description and its next instruction, and no getting
stuck if a mid-game reload fails.

**Your daily-challenge time now makes it onto the leaderboard** — Finishing
the daily challenge and entering your name used to fail for many players with
a misleading "submission failed (you may be offline)" message, even on a
solid connection — so a clean run never showed a rank. Submissions now go
through, and you see where your time lands. When a submission really is
refused for another reason, the result screen tells you that plainly instead
of blaming your network, and keeps the retry button handy.

**Your AI partner stops inventing a dial it can't see** — On the symbol
dial, your AI used to talk about a pointer or a clock face and ask you to
turn every dial to "12 o'clock" — a mechanic the game never had — then
get stuck waiting for a pointer direction you couldn't give. The manual
no longer describes what the dials look like on screen. It now tells your
AI the one thing it actually needs: ask you which symbol each dial is
currently showing, find the matching row, and tell you "press the right
arrow N times." All four module pages were rewritten to the same
principle — your AI holds the rules, you describe the screen, and your AI
never assumes anything you didn't report.

**Your AI partner reads the wire module right — and recovers in role
when a cut goes wrong** — The bomb manual now spells out the wire rules
so your AI partner stops a common slip: it walks the rules strictly in
order instead of jumping to whichever one looks most relevant, it knows a
rule that wants a color you can't see simply doesn't apply (so it moves
on rather than inventing a wire to cut), and it asks you for the battery
count or indicator state when a rule needs it instead of guessing. And
when an action does go wrong, your AI now re-checks the rules itself and
gives you a corrected move — it never turns around and asks you what the
right answer was.

**Your AI partner now leads the post-game debrief** — When a run ends,
you no longer copy a summary and paste it to your AI to get a recap. The
result page shows this run at a glance — total time, each module's time
and misses, and your daily rank — for you to read directly, and your AI
partner now takes the lead on the debrief in your ongoing voice chat:
once you tell it how the run went, it asks what tripped you up, suggests
what to change, and invites you into another round. The failure-screen
messages were rewritten to match, nudging you to talk the run over with
your AI instead of handing out canned tactics.

**AmiClaw moves to claw.amio.fans, BombSquad gets its own sub-path** —
The platform's canonical home is now `claw.amio.fans`, and BombSquad
lives at `claw.amio.fans/bombsquad` (with the run, connect, result and
compatibility screens all under the same `/bombsquad/*` prefix). The
legacy `bombsquad.amio.fans` host is preserved as a permanent
redirect — every page on it 301s to its canonical equivalent on
`claw.amio.fans`, so existing share links and AI-handed manual URLs keep
working without anyone having to update bookmarks. The mirror-mode
landing pattern matches the Yijing Oracle preview at `/oracle/*`, so
every game now lives under its own sub-path on the platform.

**AmiClaw platform homepage** — The site now opens on a full AmiClaw
platform homepage instead of a bare BombSquad launcher. A four-tab shell
(游戏 / 排行榜 / 社区 / 我的) frames the「星图 / Atlas」design: a signed-out
visitor lands on a hero with a live daily-challenge countdown, a featured
BombSquad section, and previews of upcoming games and the community feed,
while a signed-in visitor sees a personal welcome strip in the hero's
place. The existing BombSquad game flow is unchanged and stays reachable
straight from the homepage CTAs.

**Yijing Oracle preview** — A first cut of AmiClaw's second game is now
playable. The session walks you from a taiji-disc home, through picking
two of six abstract images, through six 3-coin tosses that draw a
six-line hexagram, into an AI-led cold-reading dialogue, and out to a
shareable 卦签 card with a vermilion seal. This is a design-review
preview: the reading runs on a stubbed phase machine rather than a real
AI partner, voice I/O is not wired up yet, and a tab refresh clears the
run; a later release adds a real AI partner, voice I/O, and the full
64-hexagram dataset.

### Changed

- **Drop the redundant opening-prompt panel from the AI compatibility page**
  The supported-AI page no longer shows a copy-ready opening prompt, and the
  vestigial `OPENING_PROMPT` constant behind it is removed. Your AI now gets
  everything it needs from the manual itself, which already frames its role,
  so a second hand-copied script was only a stale duplicate. The page still
  lists which voice AIs work and which are verified.
- **Yijing Oracle gets its own vanity domain** The Yijing Oracle now has a
  memorable own-domain entry at `oracle.amio.fans` that 301-redirects to
  `claw.amio.fans/oracle/*` — root lands on `/oracle`, deep links are
  prefixed onto `/oracle`, and the shared `/manual/*` and `/api/*` paths
  pass through unchanged. This matches the BombSquad vanity pattern, so
  every game now has its own memorable domain that funnels into the
  platform.
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
- **BombSquad split into its own package; the platform shell becomes the deploy
  root** The old `packages/game` workspace is split into `@amiclaw/platform`
  (the renamed deploy root that owns the homepage, leaderboard, community and
  account shell) and a new `@amiclaw/game-bombsquad` package that owns the whole
  BombSquad game flow, mirroring how the Yijing Oracle lives in its own package.
  Cross-used utilities (`format-time`, `date`, `leaderboard-api`,
  `leaderboard-optimistic`) move to the shared `@shared/*` workspace and the
  `useDailyCountdown` hook moves to `@amiclaw/ui`, so the platform and the game
  no longer duplicate them. BombSquad now builds with a `/bombsquad/` asset base
  and is assembled into the platform deploy root under `/bombsquad/`, alongside
  `/oracle/` and `/manual/`. This is a pure structural refactor — every route,
  game rule and visual is unchanged.

### Added

- **AI manual gains game framing and collaboration philosophy** The AI
  partner now receives full game context before any rule content on every
  manual fetch. `AI_INSTRUCTIONS` now carries two new top-level keys —
  `game_context` (role / player role / voice-only medium / session
  freshness: every URL fetch starts a fresh game with no cross-session
  memory) and `collaboration_philosophy` (guide the player to describe
  features instead of guessing dictionary names, admit uncertainty before
  guessing, and anchor the trust loop's data source to the BombSquad
  app-rendered recap) — alongside the existing tactical-output keys.
  Both injection paths (HTML embedded yaml and dist raw yaml at
  `?format=yaml`) carry all four key categories. Source task
  `add-bombsquad-ai-framing-and-collab-philosophy`.
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

- **AI partner no longer confuses the button's two lights** The button-module
  manual used to call both the scene's named indicators and the button's own
  press-and-hold release light「指示灯」, so a literal AI could watch the wrong
  light or apply a scene indicator's color to the release condition. The release
  light is now named「灯条」throughout the manual, terminologically distinct from
  the scene「指示灯」, so your AI tells you which light to watch on release without
  conflating it with which scene indicator a rule names. No change to puzzles,
  answers, or the game screen. Source task
  `fix-manual-light-terminology-collision`.
- **Clearing a module finally feels good** Solving a module now lands with a
  bright two-note rising chime and a quick green bloom on the panel and the
  just-filled progress segment, instead of the near-silent thunk it used to
  share with a wrong answer. Finishing a run celebrates a win with a glyph
  burst and a short rising sting, visibly and audibly distinct from the calm
  failure screen, and a correct answer mid-run flashes a confident green panel
  pulse mirroring the existing red error pulse. All restrained, dark-only,
  CSS-only, and gated behind `prefers-reduced-motion`. Source task
  `fix-bombsquad-to-invitable-quality`.
- **Honest setup copy, and a first-run scene-bar nudge** The BombSquad landing
  page no longer claims "AI 已就位" before you have connected one — it now says
  you bring your own voice AI (Claude / ChatGPT / Gemini); the connect flow's
  "switch to voice mode" step is a passive reminder instead of a fake button;
  and the AI-avatar label reads "你的 AI" rather than a hardcoded "Claude". On
  your first run, a one-time dismissible hint points you at the scene-info bar
  to read out to your AI. Source task `fix-bombsquad-to-invitable-quality`.
- **One-tap voice-AI setup, and a practice mode that onboards you** Connecting
  your AI partner is now a single tap to copy the manual link and send it —
  modern voice AIs open and read the link on their own, and the manual now
  frames the AI's role itself, so there is no separate prompt to paste — and the
  redundant pre-run "ready?" screen
  is gone, so you reach the bomb in fewer steps. In practice mode the manual now
  tells the AI to treat you as a first-timer: it opens with the
  describe-then-act loop and reminds you to read out the scene info bar, instead
  of replying in terse fragments. Source task
  `fix-bombsquad-to-invitable-quality`.
- **AI partner gains wider symbol-misread vocabulary** The shared symbol
  dictionary (`shared/symbols.ts`) now anchors more of the visual gestalts a
  real player might say when describing a symbol under time pressure. `spiral`
  picks up `'咖啡豆 / 实心椭圆带竖中线'` alongside the existing `'圆圈'` (a
  2026-05-27 playtest produced the coffee-bean misread that the previous
  description could not map back); `omega` gains `'拱门'`; and the three most
  canonical shapes (`delta` / `star` / `diamond`) carry an explicit
  `,无常见误读模式 — 略` slot so future audits see the coverage is deliberate.
  Six other ids already carried adequate explicit or implicit reverse-alias
  coverage and are unchanged. The five unreferenced placeholder symbols and
  `trident`'s PR #101 geometric description are untouched. Source task
  `reconcile-bombsquad-symbol-pool-and-aliases`.
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
- **Button-preamble regression guard** Internal refactor — a new
  `packages/manual` test locks the two hardenings in the button module's
  manual preamble (strict top-down rule-walking with no salient jump, and the
  scene-info ask-gate) across `practice.yaml` and every daily file, mirroring
  the existing wire-routing guard. The wire fix already shipped both hardenings
  but only wire was CI-protected, so a future revert of the button preamble can
  no longer pass CI silently.
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

- **The AI partner can finally use its manual** BombSquad is
  bring-your-own-AI, so the manual the voice AI fetches is its only source of
  truth — and it was failing the AI in three ways at once. The AI-fetched
  payload (`?format=yaml`) shipped without the symbol shape descriptions, so
  the AI saw bare ids like `trident` / `psi`, guessed, and gave
  confident-but-wrong steps; the descriptions are now injected into that
  payload too, character-equal to the `shared/symbols.ts` source of truth. The
  AI's role and rules of engagement (`ai_instructions`, with `game_context`
  first) were dumped _after_ 350+ lines of puzzle rules; they now lead the
  payload, so the AI knows who it is and that the player cannot see the manual
  before it reads a single rule. And the manual mixed Chinese rules with
  English instructions; it is now one all-Chinese document, carrying a global
  "you hold the only manual — never ask the player what a rule says"
  discipline that previously lived in just one module. The manual now also opens
  with a short whole-game overview — what BombSquad is, how a run flows, the
  scene info bar, and the timer and strike rules — so the AI grasps the full
  picture before any rule; and the old "every session is fresh, you have no
  memory" framing is corrected, so within one conversation the AI now remembers
  earlier rounds and gets better with you across them, the way the recap loop
  intends. Source task `fix-bombsquad-to-invitable-quality`.
- **Symbol-dial AI no longer reverse-asks for the manual** The symbol_dial
  manual's `rule:` preamble is rewritten so the AI partner stops asking the
  player "do you have a manual?" and "what is the target arrangement?" mid-run.
  The old preamble told the AI which column to look up but never anchored on
  what the player physically sees on screen, never spelled out the spoken
  command shape ("press right N times"), and never disclosed that each dial's
  6-symbol pool — five fillers plus the starting symbol — lives only in the
  frontend code and not in the manual. With those gaps the AI defaulted to
  treating the player as the manual carrier whenever it tried to project a
  post-rotation symbol. The new preamble opens with the visual anchor (three
  dials, each showing a single symbol via a 摆轮 / dial display, left / right
  arrow rotates by one slot), tells the AI to say "按右箭头 N 次" with N
  derived from the lookup column, and explicitly forbids the AI from naming
  the post-rotation symbol — the dial-after-rotation is none of the AI's
  business. Propagates to all 366 daily manuals via the seeded shuffle
  generator. No code, schema, or symbol changes.

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
- **Preview deployments can submit scores again** Score submission and
  telemetry from a Cloudflare Pages preview build (served on
  `*.amiclaw.pages.dev`) were blocked by the API's single-origin CORS, which
  only ever allowed the production `claw.amio.fans` domain — so a preview page
  calling the production API got a cross-origin rejection. The API now matches
  the request origin against an allowlist (the production domain plus this
  project's `*.amiclaw.pages.dev` preview subdomains) and echoes a matching
  origin back, falling back to the canonical domain for anything else. A new
  regression test guards the allowlist so the policy can't silently break
  again. Players on `claw.amio.fans` are unaffected.

<!-- Add every change that will land on main directly below this header. -->
<!-- Entries below are maintained manually -->
