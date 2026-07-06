import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Dev-only shell for playing creation-schema levels locally. Never built or
// deployed — zero footprint on production packages and Pages routing.
export default defineConfig({
  root: __dirname,
  plugins: [react()],
})
