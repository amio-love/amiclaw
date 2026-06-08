# Auth Session — out-of-band provisioning

The magic-link auth backend needs an `AUTH` KV namespace and a few secrets
attached to the Cloudflare **Pages** project. This repo has no checked-in
`wrangler.toml`; bindings are configured in the Pages dashboard / via the
`wrangler` CLI, exactly like the existing `LEADERBOARD` namespace and the
`DASHBOARD_TOKEN` secret.

The code ships with safe dev fallbacks, so `pnpm dev` and the tests run with
zero configuration. The steps below are required only for production / preview
to actually send email and persist sessions.

## 1. Create the `AUTH` KV namespace

```sh
wrangler kv namespace create AUTH
wrangler kv namespace create AUTH --preview
```

Then bind it to the Pages project under **Settings → Functions → KV namespace
bindings** with the variable name `AUTH` (production and preview), or via
`wrangler pages` config. The binding variable name MUST be `AUTH` — the code
reads `env.AUTH`.

## 2. Resend account + verified sending domain

1. Create a Resend account: <https://resend.com>.
2. Add and verify the sending domain (e.g. `claw.amio.fans`) — add the DKIM /
   SPF DNS records Resend shows until the domain is **Verified**. Until then,
   only `onboarding@resend.dev` works (the dev fallback `from`).
3. Create an API key (Sending access is enough).

## 3. Set the secrets (Pages production environment)

```sh
wrangler pages secret put RESEND_API_KEY
```

Optional environment variables (plain vars, not secrets — set in the Pages
dashboard or via config):

| Variable          | Purpose                                   | Default (dev fallback)            |
| ----------------- | ----------------------------------------- | --------------------------------- |
| `RESEND_API_KEY`  | Resend API key (secret)                   | unset → link logged, not emailed  |
| `AUTH_EMAIL_FROM` | Verified `From` address                   | `AmiClaw <onboarding@resend.dev>` |
| `AUTH_BASE_URL`   | Origin for verify URL + post-login target | `https://claw.amio.fans`          |

When `RESEND_API_KEY` is unset the request endpoint still returns its normal
unified response, but no email is sent — the magic link is written to the
worker log instead. Never rely on this in production.

## Tunables

Token TTL, session TTL, audit retention, and the rate-limit caps live in
`packages/api/src/auth/config.ts`. The magic-link token TTL is pinned at
≤ 15 minutes (security invariant ①); do not raise it past that bound.
