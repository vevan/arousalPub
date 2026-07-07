import type { TurnPluginEntry } from './plugin-types.js'
import {
  attachReceiveIdToTurnPluginEntriesWithPolicy,
  mergeTurnPluginEntryWithPolicy,
  removeReceiveScopedTurnPluginForReceive,
} from './shared/turn-plugin-merge.js'
import { getTurnPluginMergePolicy } from './plugin-system/turn-plugin-policies.js'

export function mergeTurnPluginEntry(
  existing: unknown[] | undefined,
  entry: TurnPluginEntry,
): unknown[] {
  return mergeTurnPluginEntryWithPolicy(
    existing,
    entry,
    getTurnPluginMergePolicy(entry.pluginId),
  )
}

/** persist 落盘前为 receive-scoped 插件条目补上 receiveId */
export function attachReceiveIdToTurnPluginEntries(
  entries: TurnPluginEntry[] | undefined,
  receiveId: string,
): TurnPluginEntry[] | undefined {
  return attachReceiveIdToTurnPluginEntriesWithPolicy(
    entries,
    receiveId,
    getTurnPluginMergePolicy,
  ) as TurnPluginEntry[] | undefined
}

/** 与落盘 merge 一致：existing + entries（已带 receiveId）合并为 turn.plugins */
export function mergePersistTurnPlugins(
  existing: unknown[] | undefined,
  entries: TurnPluginEntry[] | undefined,
  receiveId: string,
): unknown[] {
  let plugins = Array.isArray(existing) ? [...existing] : []
  const attached = attachReceiveIdToTurnPluginEntries(entries, receiveId) ?? []
  for (const entry of attached) {
    plugins = mergeTurnPluginEntry(plugins, entry)
  }
  return plugins
}

export function removeTurnPluginEntriesForReceive(
  existing: unknown[] | undefined,
  receiveId: string,
  pluginId: string,
): unknown[] {
  return removeReceiveScopedTurnPluginForReceive(
    existing,
    receiveId,
    pluginId,
    getTurnPluginMergePolicy(pluginId),
  )
}
