/**
 * Build 时把仓库 plugins/{id}/ 全量覆盖到 data/plugins/{id}/（保留各用户 settings 子目录）。
 */
import { existsSync } from 'node:fs'
import { cp, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { REPO_ROOT, resolveDataDir } from './dev-config.mjs'

const BUNDLED_PLUGIN_IDS = [
  'guidance-generate',
  'reply-complete-sound',
  'swipe-cleaner',
  'conversation-export',
  'curated-memory',
]

const CP_OPTS = { recursive: true, force: true }

async function copyBundledPluginPackage(srcDir, destDir) {
  await mkdir(destDir, { recursive: true })
  await cp(
    path.join(srcDir, 'manifest.json'),
    path.join(destDir, 'manifest.json'),
    CP_OPTS,
  )
  for (const sub of ['dist', 'locales', 'assets']) {
    const src = path.join(srcDir, sub)
    if (existsSync(src)) {
      await cp(src, path.join(destDir, sub), CP_OPTS)
    }
  }
}

async function main() {
  const dataDir = resolveDataDir()
  const pluginsDir = path.join(dataDir, 'plugins')
  await mkdir(pluginsDir, { recursive: true })

  for (const pluginId of BUNDLED_PLUGIN_IDS) {
    const src = path.join(REPO_ROOT, 'plugins', pluginId)
    if (!existsSync(path.join(src, 'manifest.json'))) {
      console.warn('[sync-plugins] bundled source missing:', pluginId, src)
      continue
    }
    const dest = path.join(pluginsDir, pluginId)
    await copyBundledPluginPackage(src, dest)
    console.log('[sync-plugins] synced', pluginId)
  }
  console.log('[sync-plugins] DATA_DIR =', dataDir)
}

main().catch((e) => {
  console.error('[sync-plugins] failed:', e)
  process.exit(1)
})
