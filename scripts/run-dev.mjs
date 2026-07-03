import { spawn } from 'node:child_process'
import { createConnection } from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { loadDevConfig } from './dev-config.mjs'
import { ensureDependencies } from './ensure-deps.mjs'
import { ensurePluginDistForDev } from './plugin-dist.mjs'
import { spawnNpm } from './spawn-npm.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const { serverPort, webPort, repoRoot: root } = loadDevConfig()

ensureDependencies(root, { label: 'dev' })

await ensurePluginDistForDev()

function waitForPort(port, { host = '127.0.0.1', timeoutMs = 90_000 } = {}) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = createConnection({ port, host }, () => {
        socket.end()
        resolve()
      })
      socket.on('error', () => {
        socket.destroy()
        if (Date.now() - start > timeoutMs) {
          reject(
            new Error(
              `Backend not listening on ${host}:${port} within ${timeoutMs / 1000}s. Check whether the port is in use or the server failed to start.`,
            ),
          )
          return
        }
        setTimeout(attempt, 400)
      })
    }
    attempt()
  })
}

const childEnv = {
  ...process.env,
  PORT: String(serverPort),
  WEB_PORT: String(webPort),
}

const server = spawnNpm(['run', 'dev', '-w', 'server'], {
  cwd: root,
  stdio: 'inherit',
  env: childEnv,
})

const pluginWatcher = spawn(process.execPath, [path.join(__dirname, 'watch-plugins.mjs')], {
  cwd: root,
  stdio: 'inherit',
  env: { ...childEnv, PLUGIN_WATCH: '1' },
})

let webProc = null

try {
  await waitForPort(serverPort)
  console.log('\n[dev] Backend ready, starting frontend …')
  console.log(
    `[dev] Ports: backend ${serverPort}, frontend ${webPort} (edit serverPort / webPort in config.yaml)`,
  )
  console.log(`[dev] Open in browser: http://localhost:${webPort}/\n`)
  webProc = spawnNpm(['run', 'dev', '-w', 'web'], {
    cwd: root,
    stdio: 'inherit',
    env: childEnv,
  })
} catch (e) {
  console.error(e instanceof Error ? e.message : e)
  server.kill('SIGTERM')
  process.exit(1)
}

function shutdown() {
  webProc?.kill('SIGTERM')
  pluginWatcher.kill('SIGTERM')
  server.kill('SIGTERM')
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

webProc?.on('exit', (code) => {
  pluginWatcher.kill('SIGTERM')
  server.kill('SIGTERM')
  process.exit(code ?? 0)
})

server.on('exit', (code) => {
  webProc?.kill('SIGTERM')
  pluginWatcher.kill('SIGTERM')
  process.exit(code ?? 0)
})

pluginWatcher.on('exit', (code) => {
  if (code != null && code !== 0) {
    console.warn(`[dev] plugin watcher exited with code ${code}`)
  }
})
