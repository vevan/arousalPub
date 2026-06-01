import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { loadDevConfig } from './dev-config.mjs'
import { runBuildCountdownPrompt } from './prompt-build-countdown.mjs'
import { printTerminalLink } from './terminal-link.mjs'

const { serverPort, repoRoot, startCountdownSeconds } = loadDevConfig()

const webIndex = path.join(repoRoot, 'web', 'dist', 'index.html')
const serverEntry = path.join(repoRoot, 'server', 'dist', 'index.js')

function runBuild() {
  console.log('[start] 正在构建 web + server …\n')
  const r = spawnSync('npm', ['run', 'build'], {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: true,
  })
  if (r.status !== 0) {
    process.exit(r.status ?? 1)
  }
}

const rebuild = await runBuildCountdownPrompt({
  seconds: startCountdownSeconds,
})
const missingDist =
  !existsSync(webIndex) || !existsSync(serverEntry)

if (rebuild || missingDist) {
  if (missingDist && !rebuild) {
    console.log('[start] 未找到构建产物，将自动 build …')
  }
  runBuild()
}

if (!existsSync(serverEntry)) {
  console.error('[start] 构建失败：缺少 server/dist/index.js')
  process.exit(1)
}
if (!existsSync(webIndex)) {
  console.error('[start] 构建失败：缺少 web/dist/index.html')
  process.exit(1)
}

const url = `http://localhost:${serverPort}/`
console.log(
  '[start] 浏览器打开（须保持本窗口运行；端口见 config.json serverPort）',
)
printTerminalLink(url)
console.log('')

const child = spawn('node', ['dist/index.js'], {
  cwd: path.join(repoRoot, 'server'),
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'production',
    SERVE_STATIC: '1',
    PORT: String(serverPort),
  },
})

child.on('exit', (code, signal) => {
  if (signal) process.exit(1)
  process.exit(code ?? 0)
})

process.on('SIGINT', () => child.kill('SIGTERM'))
process.on('SIGTERM', () => child.kill('SIGTERM'))
