import { defineConfig } from 'vitest/config'

// Standalone vitest config for the api package. Mirrors the manual package's
// approach — the api package itself is not a Vite project (handlers are
// imported into Cloudflare Pages Functions), so we depend on the vitest CLI
// only and run tests in the Node environment with workers-types ambient
// declarations supplied by tsconfig.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
  },
})
