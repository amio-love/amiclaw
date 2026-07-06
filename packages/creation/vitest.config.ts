import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Standalone vitest config mirroring the companion-memory package: this
// package is pure, game-agnostic domain data + types, so tests default to
// the Node environment (fixtures are read from disk with node:fs). The dev
// shell's component test opts into jsdom per-file via a
// `@vitest-environment jsdom` docblock, matching the platform package's
// testing-library convention.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    globals: true,
  },
})
