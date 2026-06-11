# Platform AI — Voice Session Demo

A minimal first-party harness that drives the whole `@amiclaw/platform-ai`
pipeline (STT → LLM → TTS) over the same-origin `/ai-ws/*` WebSocket, with **no
real provider credentials**.

It exists to prove the locked acceptance end to end: _speak → ASR → LLM (grounded
in the injected manual) → TTS → see / hear a deterministic reply_, and to show
the security invariant holds — the browser holds no key and no system prompt.

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
