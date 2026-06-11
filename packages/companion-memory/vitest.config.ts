import { defineConfig } from 'vitest/config'

// Standalone vitest config mirroring the api / platform-ai packages: this
// package is pure domain logic targeting a D1-shaped database interface, so
// the tests run in the Node environment. The D1 stand-in is the Node built-in
// `node:sqlite` (real SQLite — triggers, foreign keys, ON CONFLICT all behave
// exactly as on D1), wrapped by `src/test-support/sqlite-db.ts`.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
  },
})
