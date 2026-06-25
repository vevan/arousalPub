import vue from '@vitejs/plugin-vue'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vuetify from 'vite-plugin-vuetify'
import { visualizer } from 'rollup-plugin-visualizer'
// @ts-expect-error 仓库根 scripts 为 .mjs，供 Vite 与 run-dev 共用
import { loadDevConfig } from '../scripts/dev-config.mjs'

const { serverPort, webPort } = loadDevConfig()
const analyze = process.env.ANALYZE === '1' || process.env.ANALYZE === 'true'
const repoRoot = fileURLToPath(new URL('..', import.meta.url))

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
    analyze &&
      visualizer({
        filename: join(repoRoot, '.tmp', 'vite-bundle-stats.html'),
        gzipSize: true,
        brotliSize: true,
        open: false,
      }),
  ].filter(Boolean),
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('vuetify')) return 'vuetify'
          if (id.includes('virtua')) return 'virtua'
          if (id.includes('vue-i18n') || id.includes('@intlify')) return 'vue-i18n'
          if (
            id.includes('/vue/') ||
            id.includes('/vue-router/') ||
            id.includes('/pinia/')
          ) {
            return 'vue-vendor'
          }
          if (id.includes('marked')) return 'marked'
        },
      },
    },
  },
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
