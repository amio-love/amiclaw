# BombSquad Operations

## Current Status

BombSquad has working local implementations for:

- the game SPA in `packages/game/`
- the manual source/build pipeline in `packages/manual/`
- the leaderboard handlers in `packages/api/`
- same-origin Cloudflare Pages Functions in `functions/`

Local verification currently uses:

```bash
pnpm test:run
pnpm build
pnpm --filter api typecheck
```

Cloudflare infrastructure is not fully finalized yet. In particular:

- live DNS/HTTPS for `bombsquad.amio.fans` still needs verification
- the KV namespace binding still needs a real production ID during Cloudflare setup
- manual live testing with voice AI tools and mobile browsers still needs to be completed

## Production Hosting Layout

The repository now targets a single Cloudflare Pages deployment layout:

- `packages/game/dist/` is the primary Pages output
- `scripts/assemble-pages.mjs` copies `packages/manual/dist/` into `packages/game/dist/manual/`
- `functions/manual/[date].ts` serves `/manual/:date`
- `functions/api/leaderboard.ts` serves `/api/leaderboard`

This keeps the default frontend API base on the same origin:

- game SPA: `/`
- manual HTML: `/manual/:date`
- manual YAML: `/manual/:date?format=yaml`
- leaderboard API: `/api/leaderboard`

## Manual System

### Source of truth

- Practice manual source: `packages/manual/data/practice.yaml`
- Daily manual sources: `packages/manual/data/daily/YYYY-MM-DD.yaml`

### Build output

Running `pnpm --filter manual build` now generates:

- `dist/practice/index.html`
- `dist/<YYYY-MM-DD>/index.html`
- `dist/data/practice.yaml`
- `dist/data/<YYYY-MM-DD>.yaml`
- `dist/anti-human.css`

### Runtime behavior

- Browser requests to `/manual/:date` return the anti-human HTML page
- Requests with `?format=yaml` return raw manual text
- Requests that prefer `text/plain` or `application/yaml` also return raw manual text

The game currently uses the local bundled practice YAML for practice mode and the served dated YAML/manual route for daily mode.

## Publishing a New Daily Manual

1. Add a new file at `packages/manual/data/daily/YYYY-MM-DD.yaml`.
2. Keep the file name aligned with the intended challenge date.
3. Run `pnpm --filter manual build`.
4. Verify these local artifacts exist:
   - `packages/manual/dist/YYYY-MM-DD/index.html`
   - `packages/manual/dist/data/YYYY-MM-DD.yaml`
5. Run `pnpm build` to assemble the final Pages artifact.
6. Verify these final assembled artifacts exist:
   - `packages/game/dist/manual/YYYY-MM-DD/index.html`
   - `packages/game/dist/manual/data/YYYY-MM-DD.yaml`
7. Deploy the Pages project.
8. Verify the live URLs:
   - `/manual/YYYY-MM-DD`
   - `/manual/YYYY-MM-DD?format=yaml`

## Leaderboard Contract Notes

- `nickname` is still anonymous by default in the current UI.
- `ai_tool` remains supported by the shared schema, but the current UI does not collect it yet.
- `operations_hash` is still an MVP placeholder in the current submission flow and should not be treated as authoritative anti-cheat evidence yet.

## Cloudflare Setup Checklist

1. Create or select the `LEADERBOARD` KV namespace in Cloudflare.
2. Bind that namespace to the Pages project and, if the standalone worker package is used, also update `packages/api/wrangler.toml`.
3. Configure the Pages project to build from the repository root.
4. Use `pnpm build` as the build command.
5. Use `packages/game/dist` as the Pages output directory.
6. Ensure the root `functions/` directory is enabled for the Pages project.

## GitHub Actions Deployment

The repository includes `.github/workflows/pages-deploy.yml` for the
CLI-based Cloudflare Pages deployment path.

Required GitHub repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

The Cloudflare Pages project name (`bombsquad`) is hardcoded in the workflow
command — no third secret required. If the project is renamed on Cloudflare,
update `.github/workflows/pages-deploy.yml` in the same commit.

The workflow runs on pushes to `main` and on manual dispatch. It:

1. installs dependencies with pnpm
2. runs `pnpm build`
3. deploys `packages/game/dist` with `wrangler pages deploy`

The required Cloudflare API token permission is:

- Account
- Cloudflare Pages
- Edit

## Live Verification Checklist

These checks are still required against the real deployment:

```bash
curl -I https://bombsquad.amio.fans/
curl -I https://bombsquad.amio.fans/manual/practice
curl https://bombsquad.amio.fans/manual/practice?format=yaml
curl https://bombsquad.amio.fans/api/leaderboard?date=YYYY-MM-DD
```

Manual real-world checks still pending:

- one full practice run with a voice AI tool
- one full daily run with score submission
- one mobile browser smoke test on a real phone
