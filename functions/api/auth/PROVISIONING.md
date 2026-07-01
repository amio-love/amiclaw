# Auth Session — out-of-band provisioning

The auth backend needs an `AUTH` KV namespace and a few secrets attached to the
Cloudflare **Pages** project. This repo has no checked-in `wrangler.toml`;
bindings are configured in the Pages dashboard / via the `wrangler` CLI, exactly
like the existing `LEADERBOARD` namespace and the `DASHBOARD_TOKEN` secret.

The code ships with safe dev fallbacks, so `pnpm dev` and the tests run with
zero configuration. The steps below are required only for production / preview
to actually send email, run Google sign-in, and persist sessions. Magic-link
(sections 1–3) and Google OAuth (section 4) are independent — the magic-link
flow works without the Google secrets, and the Google button degrades to a
`/login?error=google_unavailable` bounce when its client id is unset.

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

| Variable          | Purpose                                   | Default (dev fallback)                |
| ----------------- | ----------------------------------------- | ------------------------------------- |
| `RESEND_API_KEY`  | Resend API key (secret)                   | unset → link logged, not emailed      |
| `AUTH_EMAIL_FROM` | Verified `From` address                   | `AMIO Arcade <onboarding@resend.dev>` |
| `AUTH_BASE_URL`   | Origin for verify URL + post-login target | `https://claw.amio.fans`              |

When `RESEND_API_KEY` is unset the request endpoint still returns its normal
unified response, but no email is sent — the magic link is written to the
worker log instead. Never rely on this in production.

## 4. Google OAuth app (the "用 Google 登录" button)

Create an OAuth 2.0 client in Google Cloud so the Google sign-in path can run.

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and select
   (or create) a project.
2. Configure the **OAuth consent screen** (APIs & Services → OAuth consent
   screen): External user type, app name (e.g. `AMIO Arcade`), support email, and
   the `openid` + `email` scopes (the only scopes the code requests).
3. Create credentials → **OAuth client ID** → application type **Web
   application**.
4. Under **Authorized redirect URIs**, add the callback URL **verbatim** — it
   MUST match the value the code computes from `AUTH_BASE_URL`:

   ```text
   https://claw.amio.fans/api/auth/google/callback
   ```

   Add a preview/localhost variant too if you test there (e.g.
   `http://localhost:8788/api/auth/google/callback`). The path is fixed
   (`GOOGLE_CALLBACK_PATH` in `packages/api/src/auth/config.ts`); only the origin
   varies, and it is derived from `AUTH_BASE_URL`, never configured separately.

5. Copy the generated **Client ID** and **Client secret**.

Set them on the Pages project (the secret as a secret; the client id may be a
plain var — it is public, but keeping both together is fine):

```sh
wrangler pages secret put GOOGLE_OAUTH_CLIENT_ID
wrangler pages secret put GOOGLE_OAUTH_CLIENT_SECRET
```

| Variable                     | Purpose                         | Default (dev fallback)                  |
| ---------------------------- | ------------------------------- | --------------------------------------- |
| `GOOGLE_OAUTH_CLIENT_ID`     | Google OAuth client id (public) | unset → Google button bounces to /login |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Google OAuth client secret      | unset → callback fails cleanly          |

The CSRF `state` and the post-login session both live in the same `AUTH` KV
namespace as the magic-link flow — no extra binding is needed for Google.

## Tunables

Token TTL, session TTL, audit retention, and the rate-limit caps live in
`packages/api/src/auth/config.ts`. The magic-link token TTL is pinned at
≤ 15 minutes (security invariant ①); do not raise it past that bound.
