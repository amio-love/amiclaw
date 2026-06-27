# Platform AI — Voice Session Demo

A minimal first-party harness that drives the whole `@amiclaw/platform-ai`
pipeline (STT → LLM → TTS) over the same-origin `/ai-ws/*` WebSocket. By default
it runs against the deterministic **mock** providers (gameId `demo-mock`), so it
needs **no real provider credentials**.

It exists to prove the locked acceptance end to end: _speak → ASR → LLM (grounded
in the injected manual) → TTS → see / hear a deterministic reply_, and to show
the security invariant holds — the browser holds no key and no system prompt.

## Audio format

Player audio is captured as **PCM16 16kHz mono** — the exact wire format the real
STT adapter expects (`../src/providers/volcengine.ts`: `format:'pcm', rate:16000,
bits:16, channel:1`). Capture uses `AudioContext({ sampleRate: 16000 })` feeding a
`ScriptProcessorNode`; each frame's Float32 samples are converted to Int16
little-endian PCM (`floatTo16BitPCM` in `audio-pcm.js`, unit-tested in
`audio-pcm.test.js`) and sent over the WS binary channel. Because the audio layer
is now protocol-correct (no more `MediaRecorder` / webm-opus), this same capture
path is reusable as-is by a real-provider / live-verification harness — only the
server-side gameId and credentials would change.

## How it works

- The page connects to the Worker WebSocket and creates a session with the
  `demo-mock` gameId.
- `demo-mock` (see `../src/provider-config.ts`) selects the deterministic **mock**
  provider on all three layers (`../src/providers/mock.ts`). No DeepSeek /
  Volcengine keys are read or required.
- The mock STT maps any audio to a fixed example transcript; the mock LLM replies
  with a sentence grounded in the manual section the platform injected
  server-side; the mock TTS emits placeholder audio frames per sentence.
- `DEV_AUTH_BYPASS=true` (set only in the demo wrangler config) makes the WS
  handshake resolve a fixed dev identity, so you can connect without a signed-in
  session cookie.

## Run it

From the package root (`packages/platform-ai/`):

```sh
pnpm exec wrangler dev --config demo/wrangler.dev.toml
```

Then open the printed local URL (default `http://localhost:8787/`) and:

1. Click **Connect session** — the log shows `Session created: …`.
2. **Hold to speak** — grant microphone access (or deny it; the mock STT yields
   its fixed transcript either way, so the turn still completes). Release to send.
3. The AI's streamed reply appears in the log, grounded in the injected manual.
4. **End session** to close and see the turn count.

## Security note (load-bearing)

This page connects **only** to the server-side Worker. It never holds a provider
API key or a system prompt — those live exclusively server-side (Cloudflare
secrets + `provider-config.ts`). The only game material the client sends is the
`demo-mock` gameId and per-run manual data, which is non-secret by design.

The mock TTS frame is the UTF-8 bytes of the sentence (a placeholder, not a real
codec), so audio playback is best-effort in mock mode. The point of the demo is
that the text and audio chunks arrive end to end; a real TTS adapter emits
decodable audio in the same slot.

## Headless live-turn harness (`live-turn.mjs`)

`demo.js` is the interactive browser page. `live-turn.mjs` is its headless,
repeatable sibling: a Node WebSocket driver that runs ONE voice turn end to end
over the same `/ai-ws/*` protocol and **asserts** the full turn completed —
proving a single orchestrated success, not just per-hop handshakes.

It drives `create → stream PCM16 frames → turn → consume chunks → end`, then
asserts on the returned `SessionSummary`: `turnCount >= 1`,
`usage.llmOutputTokens > 0`, `usage.sttInputSeconds > 0`, and that ≥1 `audio`
chunk arrived. It prints a per-hop report (ASR transcript, LLM token count, TTS
frame count + bytes) and exits `0` on success / `1` on any failed assertion.

The ASR transcript is not streamed to the client (server-side by design); the
harness reads it from `SessionSummary.highlights` (the `user:` history entry).

### Mock self-test (no credentials)

In one terminal, start the mock Worker:

```sh
pnpm exec wrangler dev --config demo/wrangler.dev.toml --port 8787
```

In another, run the driver against the `demo-mock` gameId:

```sh
node demo/live-turn.mjs --gameId demo-mock
```

With no `--fixture`, the driver generates a ~1.5s synthetic PCM16 tone in
memory — enough for the mock STT to report non-zero `sttInputSeconds` (it yields
a fixed transcript regardless of audio content). This validates the driver
mechanics with zero secrets.

### Real-provider run (local secrets)

The real run swaps the mock gameId for `demo` (DeepSeek LLM + Volcengine 火山
STT/TTS) and supplies credentials via a gitignored `.dev.vars` at the package
root:

```sh
# 1. Provide secrets (names only in the example; values stay local + gitignored)
cp demo/.dev.vars.example .dev.vars
$EDITOR .dev.vars            # fill DEEPSEEK_API_KEY and VOLC_API_KEY

# 2. Build a real-speech PCM16 16kHz mono fixture (macOS say + afconvert)
demo/make-fixture.sh "the red wire" demo/fixture-red-wire.pcm

# 3. Start the live Worker
pnpm exec wrangler dev --config demo/wrangler.live.toml --port 8787

# 4. Drive one real turn
node demo/live-turn.mjs --gameId demo --fixture demo/fixture-red-wire.pcm
```

`wrangler.live.toml` keeps `DEV_AUTH_BYPASS = "true"` (no AUTH KV / cookie
needed) and reads the provider secrets only from `.dev.vars` — no secret value
ever lands in a tracked file. The driver itself holds no key and no prompt; it
only sends the gameId + per-run manual data, exactly like `demo.js`.

### Flags

| Flag        | Default               | Meaning                                         |
| ----------- | --------------------- | ----------------------------------------------- |
| `--gameId`  | `demo-mock`           | `demo-mock` (mock) or `demo` (real providers)   |
| `--url`     | `ws://localhost:8787` | Worker WS base URL                              |
| `--fixture` | _(synthetic tone)_    | Path to a raw PCM16 16kHz mono fixture          |
| `--name`    | random                | Session name (the `/ai-ws/<name>` path segment) |
