import { spawn } from 'node:child_process'
import { createConnection } from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

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
              `在 ${timeoutMs / 1000}s 内未检测到 ${host}:${port}。请检查是否已有其它程序占用该端口，或后端启动报错。`,
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

const server = spawn('npm', ['run', 'dev', '-w', 'server'], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
})

let webProc = null

try {
  await waitForPort(3399)
  console.log('\n[dev] 后端已就绪，启动前端……')
  console.log('[dev] 浏览器打开: http://localhost:3366/\n')
  webProc = spawn('npm', ['run', 'dev', '-w', 'web'], {
    cwd: root,
    stdio: 'inherit',
    shell: true,
  })
} catch (e) {
  console.error(e instanceof Error ? e.message : e)
  server.kill('SIGTERM')
  process.exit(1)
}

function shutdown() {
  webProc?.kill('SIGTERM')
  server.kill('SIGTERM')
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

webProc?.on('exit', (code) => {
  server.kill('SIGTERM')
  process.exit(code ?? 0)
})

server.on('exit', (code) => {
  webProc?.kill('SIGTERM')
  process.exit(code ?? 0)
})
