# @amiclaw/game-botanical — Botanical Garden (植物园养护)

Player-facing app for the Botanical Garden co-op game: a 3×3 pot grid the
gardener tends by voice/text guidance from an AI botanist. React + Vite SPA,
served under `/botanical/`. The engine and level fixtures live in
`@amiclaw/creation`; the voice/text botanist runs on `@amiclaw/platform-ai`.

## Run it locally

Two commands, two terminals. The game plays fully in terminal 1; add terminal 2
to bring the AI botanist (voice + text) to life.

### 1. Play the game

```sh
pnpm --filter @amiclaw/game-botanical dev
```

Then open:

- `http://localhost:5173/botanical/` — the tutorial level (`bg-demo-001`)
- `http://localhost:5173/botanical/?level=bg-standard-001` — the standard level

Select a pot, tap a care verb (浇水 / 遮光 / 施肥 / 换盆 / 催花). A count-up
stopwatch runs; plants decay in real time and a run ends on a win (养护成功) or a
plant death (养护失败). "再玩一次" fully resets. This works with no second
terminal — only the AI botanist needs one.

### 2. Bring the AI botanist live (voice + text)

In a **second terminal**, boot the local platform-ai Worker:

```sh
pnpm --filter @amiclaw/game-botanical ai:dev
```

This runs the real `@amiclaw/platform-ai` Worker via `dev/wrangler.local.toml`
with the credential-free **`demo-mock`** provider and `DEV_AUTH_BYPASS`, bound to
`:8787` — which the game dev server's `/ai-ws` proxy points at by default. Then,
in the game:

- Click **呼叫植物学家** to open the voice panel (hands-free — just speak; the
  botanist greets first).
- Or type a question in the **打字问植物学家** box (the text fallback) and hit
  发送 — the reply streams back on the same session.

`demo-mock` is a deterministic mock (canned replies, no real speech model), so it
proves the whole pipeline — session create → manual injection → turn → reply →
gamestate steering — credential-free.

### 3. Inspect the botanist's manual

```text
http://localhost:5173/botanical/manual                       # tutorial
http://localhost:5173/botanical/manual?level=bg-standard-001 # standard
```

The `/manual` route renders the manual the AI botanist is grounded on (species
care, over-shade lockout warnings, compatibility/synergy, health & decay). It is
a dev/inspection surface — in play the gardener does not read it.

### Real botanist (`?ai=demo`) — creds required

Append `?ai=demo` to play against the real LLM + speech stack instead of
`demo-mock`. This needs a `.dev.vars` at the platform-ai package root
(`DEEPSEEK_API_KEY` + `VOLC_API_KEY`) and a real-microphone ASR check — not set
up here; pointer only. Do not probe production.

## Scripts

| Script              | What it does                                                   |
| ------------------- | -------------------------------------------------------------- |
| `dev`               | Vite dev server for the game (`:5173`, `/botanical/`)          |
| `ai:dev`            | Local platform-ai Worker for the botanist (`:8787`, demo-mock) |
| `build`             | Type-check + production build                                  |
| `test` / `test:run` | Vitest unit/RTL suite                                          |
| `test:e2e`          | Playwright WIN + LOSE runs (controlled clock)                  |
| `typecheck`         | `tsc --noEmit`                                                 |
