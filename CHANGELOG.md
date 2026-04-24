# Changelog

All notable changes to this project will be documented in this file.
Versions follow [Semantic Versioning](https://semver.org).

## [Unreleased](https://github.com/amio-love/amiclaw/compare/0.0.0...HEAD)

### Improvements

- **Cloudflare Pages deployment** GitHub Actions can now build the monorepo and
  publish the assembled Pages artifact with `wrangler pages deploy`, avoiding
  the broken dashboard deploy-command path.

### Fixed

- **Pages deploy workflow** Hoisted `wrangler` to a root devDependency so
  `pnpm exec wrangler` resolves at the workspace root. The previous setup
  had wrangler only in `packages/api`, so `cloudflare/wrangler-action` on
  every push to `main` fell back to `pnpm add wrangler@<ver>` at the root,
  which pnpm rejects in a workspace with `ERR_PNPM_ADDING_TO_ROOT` and the
  deploy step crashed before ever shipping a build. Also simplified the
  workflow to match the working `amio` repo pattern: the Pages project
  name is now hardcoded (`bombsquad`) instead of sourced from a
  `CLOUDFLARE_PAGES_PROJECT_NAME` secret that was easy to leave unset,
  added an explicit `--branch=main` to the deploy command, and dropped
  the unused `gitHubToken` input. Repo secrets shrink from three to two
  (`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`), matching `amio-love/amio`
- **Daily mode** `GamePage` now distinguishes "manual not yet published" (404)
  from generic load failures and renders a dedicated fallback that links to
  Practice mode instead of showing the opaque "Could not load manual" retry
- **Repo hygiene** Removed seven stale compiled `.js` shadow files under
  `packages/game/src/{components,store,utils}/` that were silently overriding
  the TypeScript sources at build/test time; the earlier `.gitignore` pattern
  now actually has nothing to re-ignore
- **Planning docs** Superseded the 2026-03-27 remaining-work checklist, which
  listed already-shipped items as open, with a current snapshot dated 2026-04-21
- **CI** Unblocked the main branch lint job after the `eslint-plugin-react-hooks`
  7.x upgrade by initializing `ResultPage` submit state with a lazy `useState`
  initializer instead of a synchronous `setState` inside `useEffect`
- **CI** Allowed `console.warn` and `console.error` in runtime code and included
  `.mjs` in the scripts ESLint override so build scripts no longer trip `no-console`
- **Repo hygiene** Removed three stale compiled `.js` copies of the hook sources
  and ignored `packages/*/src/**/*.js(x)` to prevent accidental re-commits
- **Automation** Added the missing Dependabot labels and removed the repo-wide CODEOWNERS assignment so dependency PRs no longer auto-request `@byheaven` for review

- **Docs** Removed the duplicate AI changelog guide and kept `docs/changelog-style-guide.md` as the single source of truth

<!-- Add every change that will land on main directly below this header. -->
<!-- Entries below are maintained manually -->
