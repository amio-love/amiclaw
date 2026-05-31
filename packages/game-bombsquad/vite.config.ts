import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  // Served from /bombsquad/ on Cloudflare Pages (merged into platform/dist/bombsquad/).
  // Vite needs the deploy sub-path so built asset URLs become /bombsquad/assets/...
  // BombSquad uses BrowserRouter, so `base` only affects built asset paths, not
  // route matching — the /bombsquad/* routes stay literal.
  base: '/bombsquad/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@shared': resolve(__dirname, '../../shared'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: true,
  },
})
