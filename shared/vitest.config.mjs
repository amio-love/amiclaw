import { defineConfig } from 'vitest/config'

/**
 * Minimal test runner for the game-agnostic `shared/` code (voice protocol +
 * hook). jsdom so `renderHook` can drive the React hook; no bundler aliases are
 * needed because the specs import their targets by relative path.
 *
 * This config is `.mjs` (not `.ts`) on purpose: `packages/api`'s tsconfig globs
 * all of `../../shared/**` under Workers options, and a `.ts` config here would
 * be type-checked by api (pulling `vitest/config` + its node:sqlite types into
 * api's program and breaking it). A `.mjs` file is invisible to that glob.
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
