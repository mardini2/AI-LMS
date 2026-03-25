// goal: Vite + React + Tailwind with dev proxy to the Nest API on port 3000.

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        // browser calls /api/foo; upstream receives /foo
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
