import { readPluginManifest } from './plugin-system/manifest.js'
import { readPluginRegistry } from './plugin-system/registry.js'

/** 已启用插件在 manifest.memory.stripBlockTags 中声明的标签 */
export async function collectPluginMemoryStripTags(): Promise<string[]> {
  const registry = await readPluginRegistry()
  const tags = new Set<string>()
  for (const entry of registry.plugins) {
    if (!entry.enabled) continue
    const manifest = await readPluginManifest(entry.id)
    const list = manifest?.memory?.stripBlockTags
    if (!Array.isArray(list)) continue
    for (const t of list) {
      if (typeof t === 'string' && t.trim()) tags.add(t.trim())
    }
  }
  return [...tags]
}
