# Companion Memory — out-of-band provisioning

The companion-memory backend needs one **D1 database** (the repo's first)
bound in TWO places — the Cloudflare **Pages** project (the
`/api/companion/*` control plane) and the **platform-ai Worker** (resolver
read at session assembly + the consolidator's writes). Same database, two
binding points, both with the variable name `COMPANION_DB`.

The code ships inert without the bindings: the control plane returns errors
only when called, the voice pipeline runs memory-less, and the tests run with
zero configuration (they use an in-process SQLite stand-in). The steps below
are required only for production / preview to actually persist memories.

## 1. Create the database and apply migrations

```sh
wrangler d1 create amiclaw-companion
```

Copy the `database_id` from the output, then apply the schema (the migrations
SSOT lives in `packages/companion-memory/migrations/`; the platform-ai
`wrangler.toml` points its `migrations_dir` there):

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

## 5. Voice mapping back-fill (deploy-blocking)

`packages/platform-ai/src/voice-id-mapping.ts` maps the platform-neutral
`voice_id` catalog to Volcengine `voice_type` tokens, and session assembly
threads the resolved token into the TTS provider as the companion's speaker.
The committed values are `PLACEHOLDER_*`: at runtime an unfilled placeholder
(or a missing mapping) degrades to the provider's default voice with a
`console.warn` — sessions still assemble, but every companion speaks the
default voice instead of its chosen one.

**Back-filling the real `voice_type` tokens is therefore a deploy-blocking
checklist item**: confirm the tokens against the Volcengine console and fill
them in before the companion feature ships. The mapping mechanism, its
completeness test, and the degrade path are already in place.
