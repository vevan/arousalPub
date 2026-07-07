import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import {
  DEFAULT_TURN_PLUGIN_MERGE_POLICY,
  type TurnPluginMergePolicy,
} from '../shared/turn-plugin-merge.js'
import { readBundledPluginCatalog } from './bundled-registry.js'
import { getGlobalPluginsDir } from './paths.js'
import { readPluginManifest } from './manifest.js'
import type { PluginManifest } from './types.js'

let policyByPluginId = new Map<string, TurnPluginMergePolicy>()
let receiveScopedAssistantResolvePluginIds: string[] = []

function policyFromManifest(manifest: PluginManifest): TurnPluginMergePolicy {
  const raw = manifest.turnPlugins
  if (!raw || typeof raw !== 'object') return DEFAULT_TURN_PLUGIN_MERGE_POLICY
  const mergeMode = raw.mergeMode
  if (mergeMode === 'receive-scoped') {
    return {
      mode: 'receive-scoped',
      receiveIdKey:
        typeof raw.receiveIdKey === 'string' && raw.receiveIdKey.trim()
          ? raw.receiveIdKey.trim()
          : 'receiveId',
    }
  }
  return DEFAULT_TURN_PLUGIN_MERGE_POLICY
}

async function listInstalledPluginIds(): Promise<string[]> {
  const root = getGlobalPluginsDir()
  if (!existsSync(root)) return []
  const entries = await readdir(root, { withFileTypes: true })
  const ids: string[] = []
  for (const ent of entries) {
    if (!ent.isDirectory()) continue
    const manifestPath = path.join(root, ent.name, 'manifest.json')
    if (existsSync(manifestPath)) ids.push(ent.name)
  }
  return ids
}

export async function refreshTurnPluginPolicies(): Promise<void> {
  const catalog = await readBundledPluginCatalog()
  const pluginIds = new Set<string>(catalog.plugins.map((p) => p.id))
  for (const id of await listInstalledPluginIds()) {
    pluginIds.add(id)
  }

  const nextPolicies = new Map<string, TurnPluginMergePolicy>()
  const receiveScoped: string[] = []

  for (const id of pluginIds) {
    const manifest = await readPluginManifest(id)
    if (!manifest) continue
    const policy = policyFromManifest(manifest)
    nextPolicies.set(id, policy)
    const hasAssistantHook = manifest.hooks?.includes(
      'resolveTurnPluginEntriesFromAssistant',
    )
    if (hasAssistantHook && policy.mode === 'receive-scoped') {
      receiveScoped.push(id)
    }
  }

  policyByPluginId = nextPolicies
  receiveScopedAssistantResolvePluginIds = receiveScoped
}

export function getTurnPluginMergePolicy(
  pluginId: string,
): TurnPluginMergePolicy {
  return policyByPluginId.get(pluginId) ?? DEFAULT_TURN_PLUGIN_MERGE_POLICY
}

export function getReceiveScopedAssistantResolvePluginIds(): readonly string[] {
  return receiveScopedAssistantResolvePluginIds
}

/** 单测注入 merge 策略 */
export function __setTurnPluginPolicyForTest(
  pluginId: string,
  policy: TurnPluginMergePolicy,
): void {
  policyByPluginId.set(pluginId, policy)
}

export function __resetTurnPluginPoliciesForTest(): void {
  policyByPluginId = new Map()
  receiveScopedAssistantResolvePluginIds = []
}

export function __setReceiveScopedAssistantResolvePluginIdsForTest(
  ids: string[],
): void {
  receiveScopedAssistantResolvePluginIds = [...ids]
}
