/**
 * Agent 设置页插件节点目录：manifest.nodeTypes（不含 tools）。
 */

import { loadEnabledServerPlugins } from '../plugin-system/loader.js'
import { readPluginManifest } from '../plugin-system/manifest.js'
import type { AgentNodeCatalogEntry } from './agent-settings-types.js'

export async function collectAgentNodeCatalog(
  userId?: string,
): Promise<AgentNodeCatalogEntry[]> {
  const loaded = await loadEnabledServerPlugins(userId)
  const out: AgentNodeCatalogEntry[] = []
  const seen = new Set<string>()

  for (const p of loaded) {
    const manifest = await readPluginManifest(p.id)
    const nodeTypes = manifest?.nodeTypes
    if (!nodeTypes?.length) continue
    for (const nt of nodeTypes) {
      const type = nt.type.trim()
      if (!type) continue
      const key = `${p.id}:${type}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        type,
        pluginId: p.id,
        version: nt.version ?? 1,
        description: nt.description ?? type,
        ...(nt.title ? { title: nt.title } : {}),
        ...(nt.titleKey ? { titleKey: nt.titleKey } : {}),
        ...(nt.descriptionKey ? { descriptionKey: nt.descriptionKey } : {}),
      })
    }
  }
  return out
}
