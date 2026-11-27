/**
 * Agent 设置页工具目录：核心检索 + 插件 tools（不含仅 serverActions）。
 */

import { isCoreAgentToolName, listCoreAgentToolDefinitions } from './host-search-tools.js'
import { collectPluginToolDecls } from './plugin-tools-aggregate.js'
import { resolveToolMaxCallsPerTurn } from './agent-tool-budget.js'
import type { AgentToolCatalogEntry } from './agent-settings-types.js'
import type { AgentToolPhase } from './agent-prose-phase.js'

export async function collectAgentToolCatalog(
  userId?: string,
): Promise<AgentToolCatalogEntry[]> {
  const out: AgentToolCatalogEntry[] = []
  for (const def of listCoreAgentToolDefinitions()) {
    const name = def.function.name
    out.push({
      name,
      description: def.function.description ?? name,
      phase: 'read',
      maxCallsPerTurn: resolveToolMaxCallsPerTurn({ name, phase: 'read' }),
      source: 'core',
    })
  }
  for (const d of await collectPluginToolDecls(userId)) {
    const phase: AgentToolPhase = d.phase === 'write' ? 'write' : 'read'
    out.push({
      name: d.name,
      description: d.definition.function.description ?? d.name,
      phase,
      maxCallsPerTurn:
        d.maxCallsPerTurn ??
        resolveToolMaxCallsPerTurn({ name: d.name, phase }),
      source: 'plugin',
      pluginId: d.pluginId,
      ...(d.uiTitleKey ? { uiTitleKey: d.uiTitleKey } : {}),
      ...(d.uiDescriptionKey ? { uiDescriptionKey: d.uiDescriptionKey } : {}),
    })
  }
  return out
}

export function catalogPhaseByTool(
  catalog: AgentToolCatalogEntry[],
): Map<string, AgentToolPhase> {
  return new Map(catalog.map((e) => [e.name, e.phase] as const))
}

export function isKnownAgentToolName(
  name: string,
  catalog: AgentToolCatalogEntry[],
): boolean {
  const n = name.trim()
  if (!n) return false
  if (isCoreAgentToolName(n)) return true
  return catalog.some((e) => e.name === n)
}
