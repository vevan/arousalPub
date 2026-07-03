/**
 * 生产构建：插件 → web + server → 同步 bundled 插件 → 写入 build meta。
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { REPO_ROOT } from './dev-config.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))

function runNpm(args, { label }) {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', args, {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      shell: true,
      env: process.env,
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${label} failed (exit ${code})`))
    })
  })
}

function runNodeScript(relPath, { label }) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(here, relPath)
    const child = spawn(process.execPath, [scriptPath], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      env: process.env,
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${label} failed (exit ${code})`))
    })
  })
}

async function main() {
  console.log('[build] sync shared sources')
  await runNodeScript('sync-all-shared.mjs', { label: 'sync-all-shared' })

  console.log('[build] plugins')
  await runNodeScript('build-plugins.mjs', { label: 'build:plugins' })

  console.log('[build] web + server')
  await Promise.all([
    runNpm(['run', 'build', '-w', 'web'], { label: 'web build' }),
    runNpm(['run', 'build', '-w', 'server'], { label: 'server build' }),
  ])

  console.log('[build] sync bundled plugins')
  await runNodeScript('sync-bundled-plugins.mjs', { label: 'sync-plugins' })

  console.log('[build] write meta')
  await runNodeScript('write-build-meta.mjs', { label: 'build-meta' })

  console.log('[build] done')
}

main().catch((e) => {
  console.error('[build] failed:', e instanceof Error ? e.message : e)
  process.exit(1)
})
