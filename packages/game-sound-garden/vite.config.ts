import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  // Served from /sound-garden/ on Cloudflare Pages (merged into
  // platform/dist/sound-garden/ by scripts/assemble-pages.mjs). The base only
  // rewrites built asset URLs; the SPA has a single screen and no router, so
  // route matching is unaffected.
  base: '/sound-garden/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      // Game-agnostic voice-session client (mode② partner) — mirrors bombsquad /
      // botanical so `useGameVoiceSession` resolves without a workspace dep.
      '@shared': resolve(__dirname, '../../shared'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: true,
  },
})
