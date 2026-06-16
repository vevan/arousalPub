/**
 * 插件 dist 同步：检测 src 是否新于 dist，并调用 plugins/{id}/build.mjs。
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { REPO_ROOT } from './dev-config.mjs'

const PLUGINS_DIR = path.join(REPO_ROOT, 'plugins')

/** 参与构建 mtime 比对的相对路径 */
const SOURCE_MARKERS = ['src', 'locales', 'manifest.json', 'bundles', 'build.mjs']

function maxMtimeInDir(dir) {
  let max = 0
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      max = Math.max(max, maxMtimeInDir(full))
    } else if (ent.isFile() && !ent.name.endsWith('.test.ts')) {
      max = Math.max(max, statSync(full).mtimeMs)
    }
  }
  return max
}

function pluginSourceMtime(pluginDir) {
  let max = 0
  for (const marker of SOURCE_MARKERS) {
    const full = path.join(pluginDir, marker)
    if (!existsSync(full)) continue
    if (marker === 'manifest.json' || marker === 'build.mjs') {
      max = Math.max(max, statSync(full).mtimeMs)
    } else {
      max = Math.max(max, maxMtimeInDir(full))
    }
  }
  return max
}

function pluginDistMtime(pluginDir) {
  const web = path.join(pluginDir, 'dist/web.mjs')
  const server = path.join(pluginDir, 'dist/server.mjs')
  if (!existsSync(web) || !existsSync(server)) return 0
  return Math.min(statSync(web).mtimeMs, statSync(server).mtimeMs)
}

export function isPluginDistStale(pluginId) {
  const pluginDir = path.join(PLUGINS_DIR, pluginId)
  const buildScript = path.join(pluginDir, 'build.mjs')
  if (!existsSync(buildScript)) return false
  const srcMtime = pluginSourceMtime(pluginDir)
  const distMtime = pluginDistMtime(pluginDir)
  return distMtime === 0 || srcMtime > distMtime
}

export async function listPluginsWithBuild() {
  const ids = await readdir(PLUGINS_DIR, { withFileTypes: true })
  return ids
    .filter((ent) => ent.isDirectory())
    .map((ent) => ent.name)
    .filter((name) => existsSync(path.join(PLUGINS_DIR, name, 'build.mjs')))
    .sort()
}

export function listStalePlugins() {
  return listPluginsWithBuildSync().filter(isPluginDistStale)
}

function listPluginsWithBuildSync() {
  return readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((ent) => ent.isDirectory())
    .map((ent) => ent.name)
    .filter((name) => existsSync(path.join(PLUGINS_DIR, name, 'build.mjs')))
    .sort()
}

export function runPluginBuild(pluginId) {
  const buildScript = path.join(PLUGINS_DIR, pluginId, 'build.mjs')
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [buildScript], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      env: process.env,
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${pluginId} build failed (exit ${code})`))
    })
  })
}

/**
 * @param {{ ids?: string[], force?: boolean }} opts
 * @returns {Promise<string[]>} 实际构建的插件 id
 */
export async function buildPlugins(opts = {}) {
  const all = await listPluginsWithBuild()
  const targets =
    opts.ids?.length
      ? opts.ids.filter((id) => all.includes(id))
      : opts.force
        ? all
        : all.filter(isPluginDistStale)

  for (const id of targets) {
    console.log(`[build:plugins] ${id}`)
    await runPluginBuild(id)
  }
  return targets
}

/** dev 启动：仅重建 src 新于 dist 的插件 */
export async function ensurePluginDistForDev() {
  const stale = listStalePlugins()
  if (stale.length === 0) {
    console.log('[dev] plugin dist 已是最新')
    return []
  }
  console.log(`[dev] 检测到 plugin dist 过期，正在重建: ${stale.join(', ')}`)
  for (const id of stale) {
    await runPluginBuild(id)
  }
  console.log('[dev] plugin dist 重建完成')
  return stale
}

export { PLUGINS_DIR, SOURCE_MARKERS }
