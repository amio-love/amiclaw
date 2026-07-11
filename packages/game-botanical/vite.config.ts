import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// Local wrangler-dev target for the voice WebSocket. game-bombsquad needs no
// proxy (served same-origin behind the platform Worker in prod); the botanical
// dev server is standalone, so it proxies /ai-ws/* to a locally-running
// platform-ai `wrangler dev`. Override the port to match your wrangler dev via
// AI_WS_TARGET (e.g. AI_WS_TARGET=http://127.0.0.1:8799 pnpm dev).
const AI_WS_TARGET = process.env.AI_WS_TARGET ?? 'http://127.0.0.1:8787'

export default defineConfig({
  // Served from /botanical/ on Cloudflare Pages (merged into the platform dist).
  // Vite needs the deploy sub-path so built asset URLs become /botanical/assets/...
  // BrowserRouter is used, so `base` only affects built asset paths, not route
  // matching — the /botanical/* routes stay literal.
  base: '/botanical/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@shared': resolve(__dirname, '../../shared'),
    },
  },
  server: {
    proxy: {
      '/ai-ws': { target: AI_WS_TARGET, ws: true, changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: true,
    // Playwright e2e specs live in e2e/ and are run by `playwright test`, not
    // vitest — keep vitest from collecting them (they import @playwright/test).
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
})
