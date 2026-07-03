/**
 * 同步全部 shared 源到 server / web（构建与 dev 前统一入口）。
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

function skipSharedSync() {
  const v = process.env.SKIP_SHARED_SYNC?.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

const SCRIPTS = [
  'sync-plot-summary-shared.mjs',
  'sync-prompt-preset-shared.mjs',
  'sync-portrait-media-shared.mjs',
  'sync-group-chat-settings-shared.mjs',
]

function runScript(name) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(here, name)
    const child = spawn(process.execPath, [scriptPath], {
      cwd: path.join(here, '..'),
      stdio: 'inherit',
      env: process.env,
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${name} failed (exit ${code})`))
    })
  })
}

async function main() {
  if (skipSharedSync()) return
  for (const script of SCRIPTS) {
    await runScript(script)
  }
  console.log('[sync-all-shared] ok')
}

main().catch((e) => {
  console.error('[sync-all-shared] failed:', e)
  process.exit(1)
})
