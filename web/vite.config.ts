import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vuetify from 'vite-plugin-vuetify'

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [
    vue(),
    vuetify({ autoImport: true }),
  ],
  server: {
    host: true,
    port: 3366,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3399', changeOrigin: true },
      '/health': { target: 'http://127.0.0.1:3399', changeOrigin: true },
    },
  },
  preview: {
    host: true,
    port: 3366,
    strictPort: true,
  },
})
