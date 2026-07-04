import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api/remove-bg': 'http://127.0.0.1:5180',
      '/api/survey': 'http://127.0.0.1:5180',
      '/api/contact': 'http://127.0.0.1:5180',
    },
  },
})
