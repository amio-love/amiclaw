# @amiclaw/creation

Game-agnostic creation-schema meta-model: TypeScript types, YAML loader,
validators (universal checks + hidden_info_coop and co_build floor checks),
a minimal declarative rule engine, and the Radio Cipher + Sound Garden
case-game fixtures. The design SSOT is
`docs/architecture/arch-component-creation-schema.md`.

## Dev shell (playable prototype)

A dev-only Vite shell for playing a level locally — one human acts both
roles over the engine's leak-guarded per-role views. Pipeline validation UI,
not product UI; it has zero footprint on the production packages.

```sh
pnpm --filter @amiclaw/creation dev
```

Then open the printed local URL. Features: a game selector (Radio Cipher /
Sound Garden), per-role tabs (authentic hidden info; symmetric shared
timeline for co_build), vocabulary-driven action panel, running score for
score_threshold levels, placement badges under the construction model, event
log, win banner, restart, and a clearly-labeled "self-play spoiler" toggle
that shows both role views side-by-side for solo testing.

## Tests

```sh
pnpm --filter @amiclaw/creation test:run
pnpm --filter @amiclaw/creation typecheck
```
