import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Served from /radio-cipher/ on Cloudflare Pages (merged into the platform
// dist). Vite needs the deploy sub-path so built asset URLs become
// /radio-cipher/assets/... The app routes via the URL hash (`#/`, `#/codebook`,
// `?level=N`), which is base-path agnostic, so `base` only affects asset paths.
export default defineConfig({
  base: '/radio-cipher/',
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
