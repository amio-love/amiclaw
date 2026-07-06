# Companion Memory — out-of-band provisioning

The account data backend currently uses one **D1 database** (the repo's first).
It was introduced for companion-memory and is now also used by the
arcade-profile component for small account-owned game profile records. The same
physical database is bound in TWO places — the Cloudflare **Pages** project (the
`/api/companion/*` control plane) and the **platform-ai Worker** (resolver
read at session assembly + the consolidator's writes). Same database, two
binding points, both with the variable name `COMPANION_DB`.

The code ships inert without the bindings: the control plane returns errors
only when called, the voice pipeline runs memory-less, and the tests run with
zero configuration (they use an in-process SQLite stand-in). The steps below
are required only for production / preview to actually persist memories and
account Arcade profile records.

## 1. Create the database and apply migrations

```sh
wrangler d1 create amiclaw-companion
```

Copy the `database_id` from the output, then apply the schema. The physical
migrations SSOT currently lives in `packages/companion-memory/migrations/`
because that package created the database first; migration `0002` adds
arcade-profile tables owned by `packages/arcade-profile`, not by Companion
Memory. The platform-ai `wrangler.toml` points its `migrations_dir` there:

```sh
cd packages/platform-ai
wrangler d1 migrations apply amiclaw-companion --remote
```

## 2. Bind it to the Pages project (control plane)

Under **Settings → Functions → D1 database bindings**, add the database with
the variable name `COMPANION_DB` (production and preview). The binding
variable name MUST be `COMPANION_DB` — the code reads `env.COMPANION_DB`.

The control plane also reuses the existing `AUTH` KV binding (require-session
guard); no new KV setup is needed beyond `functions/api/auth/PROVISIONING.md`.

## 3. Back-fill the platform-ai Worker binding

In `packages/platform-ai/wrangler.toml`, replace
`PLACEHOLDER_COMPANION_D1_DATABASE_ID` with the real `database_id` from
step 1, then deploy the Worker. This wires both the assembly-time resolver
read and the `CompanionConsolidatorDO` alarm job (its DO binding +
`v2` migration are already declared in the same file).

## 4. Consolidation LLM (optional but recommended)

The consolidator reuses the Worker's existing `DEEPSEEK_API_KEY` /
`DEEPSEEK_BASE_URL` configuration (text path). When the key is unset, the job
degrades to settlement-facts-only consolidation — episodes from conversation
highlights and all profile claims are skipped.

## 5. Voice mapping configuration (deploy-blocking)

`packages/platform-ai/src/voice-id-mapping.ts` maps the platform-neutral
`voice_id` catalog to Volcengine `voice_type` tokens at session assembly time.
The concrete vendor tokens are deploy configuration, not source code. Configure
all three Worker env values before exposing the companion feature:

- `VOLC_TTS_VOICE_COMPANION_WARM`
- `VOLC_TTS_VOICE_COMPANION_BRIGHT`
- `VOLC_TTS_VOICE_COMPANION_CALM`

Confirm the real `voice_type` tokens in the Volcengine console or provider
dashboard. Do not guess token strings and do not commit token values to source.
At runtime, a missing value degrades to the provider default voice with a
`console.warn`; the session still assembles, but the selected companion voice is
not honored. Launch readiness must fail loud on that condition.

Run the low-side-effect readiness gate after deployment:

```sh
PLATFORM_AI_BASE_URL=https://claw.amio.fans \
VOLC_TTS_VOICE_COMPANION_WARM=<real token> \
VOLC_TTS_VOICE_COMPANION_BRIGHT=<real token> \
VOLC_TTS_VOICE_COMPANION_CALM=<real token> \
pnpm --filter @amiclaw/platform-ai smoke:readiness
```

If the voice values are deployed as Worker secrets, also verify the deployed
secret names without reading their values:

```sh
RUN_WORKER_SECRET_NAME_CHECK=1 \
pnpm --filter @amiclaw/platform-ai smoke:readiness
```

See `packages/platform-ai/POST_DEPLOY_READINESS.md` for the D1, `USAGE`, auth,
and log-lookup checks that complete the mode2 launch gate.
