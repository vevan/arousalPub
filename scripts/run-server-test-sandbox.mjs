/**
 * B3+：PLUGIN_SERVER_SANDBOX=1 下跑 server 全量测试（含 bundled 插件单测）。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSyncNpm } from './spawn-npm.mjs'

const serverDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server')

const result = spawnSyncNpm(['test'], {
  cwd: serverDir,
  stdio: 'inherit',
  env: { ...process.env, PLUGIN_SERVER_SANDBOX: '1' },
})

process.exit(result.status ?? 1)
