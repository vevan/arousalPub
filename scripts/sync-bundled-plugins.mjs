/**
 * Build 时把仓库 plugins/{id}/ 全量覆盖到 data/plugins/{id}/（保留各用户 settings 子目录）。
 * bundled 列表来自 plugins/bundled-registry.json。
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { cp, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { REPO_ROOT, resolveDataDir } from './dev-config.mjs'

const REGISTRY_PATH = path.join(REPO_ROOT, 'plugins', 'bundled-registry.json')

const CP_OPTS = { recursive: true, force: true }

async function readBundledIds() {
  const raw = await readFile(REGISTRY_PATH, 'utf8')
  const doc = JSON.parse(raw)
  if (!doc?.plugins?.length) throw new Error('empty bundled-registry.json')
  return doc.plugins.map((p) => ({
    id: String(p.id),
    path: typeof p.path === 'string' && p.path.trim() ? p.path.trim() : String(p.id),
  }))
}

async function copyBundledPluginPackage(srcDir, destDir) {
  await mkdir(destDir, { recursive: true })
  await cp(
    path.join(srcDir, 'manifest.json'),
    path.join(destDir, 'manifest.json'),
    CP_OPTS,
  )
  for (const sub of ['dist', 'locales', 'assets', 'bundles']) {
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

  const bundled = await readBundledIds()

  for (const { id: pluginId, path: relPath } of bundled) {
    const src = path.join(REPO_ROOT, 'plugins', relPath)
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
