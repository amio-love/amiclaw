import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  // Served from /oracle/ on Cloudflare Pages (merged into game/dist/oracle/).
  // Vite needs the deploy sub-path so built asset URLs become /oracle/assets/...
  // HashRouter is base-path agnostic, so only asset paths need the prefix.
  base: '/oracle/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@shared': resolve(__dirname, '../../shared'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
