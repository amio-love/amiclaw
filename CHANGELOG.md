# Changelog

All notable changes to this project will be documented in this file.
Versions follow [Semantic Versioning](https://semver.org).

## [Unreleased](https://github.com/amio-love/amiclaw/compare/0.0.0...HEAD)

### Improvements

- **Cloudflare Pages deployment** GitHub Actions can now build the monorepo and
  publish the assembled Pages artifact with `wrangler pages deploy`, avoiding
  the broken dashboard deploy-command path.

### Fixed

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
