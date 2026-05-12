import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

// Standalone vitest config for the manual package. The package itself is not
// a Vite project (it ships static HTML built by `tsx build.ts`), so we avoid
// installing the full vite dependency — vitest 4.x bundles esbuild and is
// usable on its own. The `@shared` alias mirrors the game package so test
// files can import from `shared/` via the same path as production code.
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, '../../shared'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
  },
})
