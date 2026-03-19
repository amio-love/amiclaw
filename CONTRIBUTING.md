# Contributing to AmiClaw

Thank you for your interest in contributing!

## Getting Started

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Make your changes
4. Run `pnpm lint` and `pnpm test:run`
5. Commit using [conventional commits](https://www.conventionalcommits.org/): `git commit -m "feat: add your feature"`
6. Push and open a pull request

## Commit Convention

This project uses [Conventional Commits](https://www.conventionalcommits.org/):

| Type       | When to use                 |
| ---------- | --------------------------- |
| `feat`     | New feature                 |
| `fix`      | Bug fix                     |
| `docs`     | Documentation only          |
| `refactor` | Code change, no feature/fix |
| `test`     | Adding or updating tests    |
| `chore`    | Maintenance, dependencies   |

## Pull Request Guidelines

- Keep PRs focused on a single concern
- Include tests for new behavior
- Update documentation if needed
- Update `CHANGELOG.md` under `Unreleased` for every change that will land on `main`
- Ensure CI passes before requesting review
- Use the repository PR template

## Release Workflow

Every change that lands on `main` must be recorded in `CHANGELOG.md` directly
below the `Unreleased` header. Keep the newest unreleased notes there as work
lands, instead of waiting until release day.

On release day:

1. Curate the `Unreleased` notes into the new versioned section
2. Reset `Unreleased` so it compares the new tag to `HEAD`
3. Bump the version file if the project starts using one
4. Commit the release changes
5. Tag that exact commit
6. Push the release commit and tag

Use `docs/changelog-style-guide.md` when drafting changelog content.

## Reporting Issues

Use the GitHub issue tracker. For bugs, include:

- Steps to reproduce
- Expected vs actual behavior
- Environment details (OS, version)
