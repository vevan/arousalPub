/**
 * DOC/42 DoD D.2：bundled-registry 为空时宿主仍可 TypeScript 编译。
 *
 * 临时写入空 registry → server tsc + web typecheck → 恢复原文件。
 */
import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSyncNpm } from './spawn-npm.mjs'

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)

const REGISTRY_PATH = path.join(REPO_ROOT, 'plugins', 'bundled-registry.json')
const BACKUP_PATH = path.join(REPO_ROOT, '.tmp', 'bundled-registry.backup.json')

const EMPTY_REGISTRY = `${JSON.stringify({ version: 1, plugins: [] }, null, 2)}\n`

function runNodeScript(relPath, label) {
  console.log(`[verify:host-no-bundled] ${label}`)
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(REPO_ROOT, 'scripts', relPath)
    const child = spawn(process.execPath, [scriptPath], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      env: process.env,
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${label} failed (exit ${code ?? 'unknown'})`))
    })
  })
}

function runNpmStep(label, args) {
  console.log(`[verify:host-no-bundled] ${label}`)
  const result = spawnSyncNpm(args, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: { ...process.env, SKIP_SHARED_SYNC: '1' },
  })
  if (result.status !== 0) {
    throw new Error(`${label} failed (exit ${result.status ?? 'unknown'})`)
  }
}

async function restoreRegistry(original) {
  await writeFile(REGISTRY_PATH, original, 'utf8')
}

async function main() {
  const original = await readFile(REGISTRY_PATH, 'utf8')
  await writeFile(BACKUP_PATH, original, 'utf8')

  try {
    await writeFile(REGISTRY_PATH, EMPTY_REGISTRY, 'utf8')
    console.log('[verify:host-no-bundled] bundled-registry → empty')

    runNodeScript('sync-all-shared.mjs', 'sync shared')
    runNpmStep('server tsc', ['run', 'build', '-w', 'server'])
    runNpmStep('web typecheck', ['run', 'typecheck', '-w', 'web'])

    console.log('[verify:host-no-bundled] ok')
  } finally {
    await restoreRegistry(original)
    console.log('[verify:host-no-bundled] restored bundled-registry.json')
  }
}

main().catch((e) => {
  console.error('[verify:host-no-bundled] failed:', e instanceof Error ? e.message : e)
  process.exit(1)
})
