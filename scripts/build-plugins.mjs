/**
 * 构建 plugins/{id}/ 下所有带 build.mjs 的插件包（当前仅 curated-memory）。
 */
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { REPO_ROOT } from './dev-config.mjs'

function runNodeScript(scriptPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      env: process.env,
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`build failed: ${scriptPath} (exit ${code})`))
    })
  })
}

async function main() {
  const pluginsDir = path.join(REPO_ROOT, 'plugins')
  const ids = await readdir(pluginsDir, { withFileTypes: true })
  const built = []

  for (const ent of ids) {
    if (!ent.isDirectory()) continue
    const buildScript = path.join(pluginsDir, ent.name, 'build.mjs')
    if (!existsSync(buildScript)) continue
    console.log(`[build:plugins] ${ent.name}`)
    await runNodeScript(buildScript)
    built.push(ent.name)
  }

  if (built.length === 0) {
    console.log('[build:plugins] no plugins with build.mjs')
  } else {
    console.log('[build:plugins] done:', built.join(', '))
  }
}

main().catch((e) => {
  console.error('[build:plugins] failed:', e)
  process.exit(1)
})
