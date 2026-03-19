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
- Ensure CI passes before requesting review
- Use the repository PR template

## Release Workflow

Normal development lands on `main`. On release day:

1. Edit `CHANGELOG.md`
2. Bump the version file if the project starts using one
3. Commit the release changes
4. Tag that exact commit
5. Push the release commit and tag

Use `docs/changelog-style-guide.md` when drafting changelog content.

## Reporting Issues

Use the GitHub issue tracker. For bugs, include:

- Steps to reproduce
- Expected vs actual behavior
- Environment details (OS, version)
