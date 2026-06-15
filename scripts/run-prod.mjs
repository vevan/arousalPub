import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  buildMetaPath,
  getGitHeadCommit,
  isBuildStaleForGit,
  readBuildMeta,
} from './build-meta.mjs'
import { loadDevConfig } from './dev-config.mjs'
import { ensureDependencies } from './ensure-deps.mjs'
import { runBuildCountdownPrompt } from './prompt-build-countdown.mjs'
import { printTerminalLink } from './terminal-link.mjs'

const { serverPort, repoRoot, startCountdownSeconds } = loadDevConfig()

const webIndex = path.join(repoRoot, 'web', 'dist', 'index.html')
const serverEntry = path.join(repoRoot, 'server', 'dist', 'index.js')

function runBuild() {
  console.log('[start] Building web + server …\n')
  const r = spawnSync('npm', ['run', 'build'], {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: true,
  })
  if (r.status !== 0) {
    process.exit(r.status ?? 1)
  }
}

function logGitStaleReason() {
  const current = getGitHeadCommit(repoRoot)
  const meta = readBuildMeta(buildMetaPath(repoRoot))
  const built = meta?.gitCommit?.slice(0, 7) ?? '(none)'
  const now = current?.slice(0, 7) ?? '?'
  console.log(
    `[start] Git commit changed (${built} → ${now}), rebuilding …`,
  )
}

ensureDependencies(repoRoot, { label: 'start' })

const missingDist =
  !existsSync(webIndex) || !existsSync(serverEntry)
const gitStale = isBuildStaleForGit({ repoRoot })

if (missingDist || gitStale) {
  if (missingDist) {
    console.log('[start] Build output not found, building …')
  } else {
    logGitStaleReason()
  }
  runBuild()
} else {
  const rebuild = await runBuildCountdownPrompt({
    seconds: startCountdownSeconds,
  })
  if (rebuild) {
    runBuild()
  }
}

if (!existsSync(serverEntry)) {
  console.error('[start] Build failed: missing server/dist/index.js')
  process.exit(1)
}
if (!existsSync(webIndex)) {
  console.error('[start] Build failed: missing web/dist/index.html')
  process.exit(1)
}

const url = `http://localhost:${serverPort}/`
console.log(
  '[start] Open in browser (keep this window running; port in config.yaml serverPort)',
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
