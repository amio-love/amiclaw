import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

// Workerd-backed vitest config for the platform-ai package. The session DO is a
// Cloudflare Durable Object whose WebSocket lifecycle (and, after the Agents SDK
// adoption, the `agents`/partyserver connection layer) can only be exercised in
// the real workerd runtime — `@cloudflare/vitest-pool-workers` runs the whole
// suite inside workerd, instantiating the DO through the `VOICE_SESSION` binding
// declared in `wrangler.toml`. The pure-logic suites run in the same runtime.
//
// `@cloudflare/vitest-pool-workers@0.16` (Vitest 4) exposes the pool as the
// `cloudflareTest` Vite plugin; the worker config that used to live under
// `test.poolOptions.workers` is now the plugin argument.
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.vitest.toml' } })],
  test: {
    globals: true,
  },
})
