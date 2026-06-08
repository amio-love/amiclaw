import { defineConfig } from 'vitest/config'

// Standalone vitest config for the platform-ai package. Mirrors the api
// package's approach — this package is a Cloudflare Worker (Durable Object +
// WebSocket orchestration land in later rounds), not a Vite project, so we
// depend on the vitest CLI only and run the pure-logic tests in the Node
// environment with workers-types ambient declarations supplied by tsconfig.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
  },
})
