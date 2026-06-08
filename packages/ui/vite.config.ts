import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// @amiclaw/ui ships source-only (no build); this config exists purely to run
// the package's component tests under jsdom, matching the platform and
// game-bombsquad vitest setups.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: true,
  },
})
