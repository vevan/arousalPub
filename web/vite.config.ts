import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vuetify from 'vite-plugin-vuetify'
// @ts-expect-error 仓库根 scripts 为 .mjs，供 Vite 与 run-dev 共用
import { loadDevConfig } from '../scripts/dev-config.mjs'

const { serverPort, webPort } = loadDevConfig()

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
    port: webPort,
    strictPort: true,
    proxy: {
      '/api': { target: `http://127.0.0.1:${serverPort}`, changeOrigin: true },
      '/health': { target: `http://127.0.0.1:${serverPort}`, changeOrigin: true },
    },
  },
  preview: {
    host: true,
    port: webPort,
    strictPort: true,
  },
})
