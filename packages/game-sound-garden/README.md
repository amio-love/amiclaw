# 声音花园 (Sound Garden) — playability probe

A standalone, playable probe for the **co_build** game "声音花园", built on the
`@amiclaw/creation` engine (zero engine changes). You and an AI 园丁伙伴 plant a
singing garden on an 8-beat timeline: you place pieces on your lane, the partner
answers on the other lane, and same-beat pairs score through a hidden harmony
matrix. Free-flow, no-fail — reaching the target score makes the garden bloom.

> Standalone by construction: this package is **not** wired into
> `scripts/assemble-pages.mjs`, so it never reaches production (`claw.amio.fans`).

## Run it

```bash
pnpm --filter @amiclaw/game-sound-garden dev
# open the printed http://localhost:<port>/sound-garden/  (Chrome recommended)
```

- **Chrome is recommended** — the browser voice input (push-to-talk ASR) uses
  Web Speech (`webkitSpeechRecognition`), which is a Chrome/Chromium feature.
- Tap any piece / the play button to unlock audio (iOS/Chrome autoplay policy).
- No keys are required to play. Everything below is optional enrichment.

## Optional keys (real AI partner + voice)

Copy `.env.example` to `.env` and fill in either key. They are read
**server-side only** by the dev API and never reach the browser.

| Key                | Enables                                           |
| ------------------ | ------------------------------------------------- |
| `DEEPSEEK_API_KEY` | Real LLM partner brain (`/api/partner`, DeepSeek) |
| `VOLC_API_KEY`     | Doubao TTS 2.0 partner voice (`/api/tts`)         |

The client asks `/api/capabilities` at session start and picks its brain + voice
from what is present.

## Degradation chain (always playable)

| Concern       | With key                    | Without key / on failure                  |
| ------------- | --------------------------- | ----------------------------------------- |
| Partner brain | DeepSeek via `/api/partner` | Offline **scripted brain** (per turn)     |
| Partner voice | Doubao TTS via `/api/tts`   | Browser **speechSynthesis** → else silent |
| Player voice  | Push-to-talk Web Speech ASR | Mic chip hidden (type-free play)          |

Every online path falls back on the next failure, so a dead key, a dead
Volcengine grant, or an unsupported browser never blocks play. A production
`vite build` has no dev server at all — the built preview simply runs fully
offline (scripted brain + browser voice).

> **Note:** the Doubao TTS path is correct-by-construction (the binary-WS codec
> is lifted from `packages/platform-ai/src/providers/volcengine.ts`) but is
> **unverified end-to-end** — the Volcengine grant could not be checked from the
> repo. speechSynthesis is the load-bearing voice fallback.

## Scripts

| Script              | What it does                         |
| ------------------- | ------------------------------------ |
| `dev`               | Vite dev server + the dev API routes |
| `build`             | `tsc && vite build` (static SPA)     |
| `typecheck`         | `tsc --noEmit`                       |
| `test` / `test:run` | Vitest (watch / once)                |
