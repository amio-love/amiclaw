# Platform AI post-deploy readiness

This runbook is for the mode2 Platform AI Worker and Companion D1 launch gate.
It is intentionally low-side-effect: the default smoke path performs no live
writes. Checks that create a session, write `USAGE`, or trigger companion capture
require explicit opt-in flags.

## Preconditions

- The `platform-ai` Worker is deployed to the canonical route
  `claw.amio.fans/ai-ws/*`.
- `packages/platform-ai/wrangler.toml` keeps Workers Logs enabled:
  `[observability].enabled = true`.
- The Worker has `AUTH`, `USAGE`, `COMPANION_DB`, `VOICE_SESSION`, and
  `COMPANION_CONSOLIDATOR` bindings configured.
- The Pages project has `AUTH` and `COMPANION_DB` bindings configured for the
  `/api/auth/*` and `/api/companion/*` control plane.
- The real Volcengine companion voice tokens are configured as Worker env vars
  or secrets:
  - `VOLC_TTS_VOICE_COMPANION_WARM`
  - `VOLC_TTS_VOICE_COMPANION_BRIGHT`
  - `VOLC_TTS_VOICE_COMPANION_CALM`

Do not commit those token values to source. Confirm them in the Volcengine
console or provider dashboard, then set them with the same deployment mechanism
used for the other Worker secrets or vars.

## Default smoke

Run from the repo root:

```sh
PLATFORM_AI_BASE_URL=https://claw.amio.fans \
VOLC_TTS_VOICE_COMPANION_WARM=<real token> \
VOLC_TTS_VOICE_COMPANION_BRIGHT=<real token> \
VOLC_TTS_VOICE_COMPANION_CALM=<real token> \
pnpm --filter @amiclaw/platform-ai smoke:readiness
```

Default checks:

- `voice_id` launch readiness: every platform voice id has a configured
  Volcengine `voice_type` value in the shell running the check. This proves the
  resolver will not send guessed or placeholder tokens; use the remote secret
  check below to verify the deployed Worker has the same names configured.
- Unauthenticated `wss://claw.amio.fans/ai-ws/*` handshakes reject with `401`.
- If `PLATFORM_AI_AUTH_COOKIE` is provided, the script also performs a read-only
  `GET /api/companion/profile`; `200` or `404` means Pages auth and
  `COMPANION_DB` binding are visible.

## Opt-in checks

### Deployed voice secret names

This is read-only and uses Wrangler to verify that the deployed `platform-ai`
Worker has the three companion voice secret names. It confirms secret presence,
not secret values.

```sh
RUN_WORKER_SECRET_NAME_CHECK=1 \
pnpm --filter @amiclaw/platform-ai smoke:readiness
```

Expected result: `wrangler secret list` includes
`VOLC_TTS_VOICE_COMPANION_WARM`, `VOLC_TTS_VOICE_COMPANION_BRIGHT`, and
`VOLC_TTS_VOICE_COMPANION_CALM`.

### Login-gated session create shape

This creates and ends one `demo-mock` WebSocket session. It does not call real
AI providers, but normal teardown can write a zero-usage `USAGE` record and can
hand the summary to `COMPANION_CONSOLIDATOR`.

```sh
PLATFORM_AI_AUTH_COOKIE='amiclaw_session=<session id>' \
RUN_SESSION_CREATE_CHECK=1 \
pnpm --filter @amiclaw/platform-ai smoke:readiness
```

Expected result: a `created` frame with a UUID `sessionId`, followed by a
`summary` frame after the script sends `end`.

### Companion D1 schema read

This is read-only and uses Wrangler against the remote D1 database:

```sh
RUN_D1_SCHEMA_CHECK=1 \
COMPANION_D1_DATABASE_NAME=amiclaw-companion \
pnpm --filter @amiclaw/platform-ai smoke:readiness
```

Expected result: the remote database exposes the full initial Companion Memory
schema: `companion`, `episode`, `profile_claim`, `profile_claim_evidence`,
`asset_entry`, and `capture_event`.

### USAGE write visibility

This writes, reads, and deletes one `readiness-smoke:*` key. Run only when you
intend to mutate the production `USAGE` namespace for a smoke check.

```sh
RUN_USAGE_WRITE_CHECK=1 \
USAGE_KV_NAMESPACE_ID=<USAGE namespace id> \
pnpm --filter @amiclaw/platform-ai smoke:readiness
```

Expected result: the key is written, read back, and deleted successfully.

## Manual trace lookup

Workers Logs and Query Builder only have data after observability is enabled in
Wrangler and the Worker has been redeployed.

- Real-time tail:

  ```sh
  pnpm exec wrangler --config=packages/platform-ai/wrangler.toml tail platform-ai
  ```

- Cloudflare dashboard Query Builder:
  - Dataset: Workers Logs.
  - Worker: `platform-ai`.
  - Time window: the smoke run time.
  - Useful text filters: `turn-trace`, `companion-capture`,
    `companion-consolidator`, `voice-id-mapping`, `usage flush failed`.

For a session-create opt-in smoke, confirm that the `created`/`summary` path is
near the logs for that time window and that no provider-secret or binding-missing
error appears.

## Readiness interpretation

- A missing `VOLC_TTS_VOICE_COMPANION_*` value is launch-blocking. Runtime
  sessions still fail open to the provider default voice, but launch readiness
  must fail loud because a chosen companion voice would not be honored.
- If the voice values are deployed as Worker secrets, run the deployed secret
  name check before launch. A local shell value alone does not prove production
  has the binding.
- A `401` for unauthenticated `/ai-ws/*` is required. A successful unauthenticated
  WebSocket upgrade is a blocker.
- `GET /api/companion/profile` returning `500` with a valid auth cookie usually
  means Pages cannot see `COMPANION_DB`, the schema is missing, or the auth
  binding is misconfigured.
- A failed `USAGE` smoke does not block the player path at runtime, but it blocks
  launch readiness because usage visibility is required for mode2 exposure.
