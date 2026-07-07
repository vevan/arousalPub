/**
 * dev 期间监听 plugins 源码变更并重建 dist。
 */
import { watch } from 'node:fs'
import path from 'node:path'
import {
  listPluginsWithBuild,
  runPluginBuild,
  isPluginDistStale,
  PLUGINS_DIR,
} from './plugin-dist.mjs'

function shouldTriggerRelPath(rel) {
  const n = rel.replace(/\\/g, '/')
  if (n.includes('/dist/') || n.startsWith('dist/')) return false
  if (n.endsWith('.test.ts')) return false
  if (n.startsWith('src/')) return true
  if (n.startsWith('locales/')) return true
  if (n.startsWith('bundles/')) return true
  if (n === 'manifest.json' || n === 'build.mjs') return true
  return false
}

const debounceMs = 300
/** build 结束后忽略 Windows 上读盘/写 dist 触发的伪变更 */
const postBuildQuietMs = 2_000
const timers = new Map()
const building = new Set()
const quietUntil = new Map()

function scheduleBuild(pluginId) {
  const prev = timers.get(pluginId)
  if (prev) clearTimeout(prev)
  timers.set(
    pluginId,
    setTimeout(() => {
      timers.delete(pluginId)
      void rebuild(pluginId)
    }, debounceMs),
  )
}

async function rebuild(pluginId) {
  if (building.has(pluginId)) return
  if (!isPluginDistStale(pluginId)) return
  building.add(pluginId)
  try {
    console.log(`\n[watch:plugins] rebuilding ${pluginId} …`)
    await runPluginBuild(pluginId)
    quietUntil.set(pluginId, Date.now() + postBuildQuietMs)
    console.log(`[watch:plugins] ${pluginId} done\n`)
  } catch (e) {
    quietUntil.set(pluginId, Date.now() + postBuildQuietMs)
    console.error(`[watch:plugins] ${pluginId} failed:`, e instanceof Error ? e.message : e)
  } finally {
    building.delete(pluginId)
  }
}

function onPluginFileChange(pluginId, filename) {
  if (building.has(pluginId)) return
  const until = quietUntil.get(pluginId) ?? 0
  if (Date.now() < until) return
  if (!isPluginDistStale(pluginId)) {
    if (process.env.PLUGIN_WATCH_DEBUG === '1') {
      console.log(
        `[watch:plugins] ignore spurious change ${pluginId}/${filename ?? '?'}`,
      )
    }
    return
  }
  scheduleBuild(pluginId)
}

const ids = await listPluginsWithBuild()
if (ids.length === 0) {
  console.log('[watch:plugins] no plugins with build.mjs')
  process.exit(0)
}

for (const id of ids) {
  const pluginDir = path.join(PLUGINS_DIR, id)
  watch(pluginDir, { recursive: true }, (_event, filename) => {
    if (!filename || typeof filename !== 'string') return
    if (!shouldTriggerRelPath(filename)) return
    onPluginFileChange(id, filename)
  })
  console.log(`[watch:plugins] watching ${id}`)
}
