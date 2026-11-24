import { createPluginServerHostApi } from './plugin-system/host-api.js'
import { loadEnabledServerPlugins } from './plugin-system/loader.js'
import { getTurnPluginMergePolicy } from './plugin-system/turn-plugin-policies.js'
import type { TurnReceive } from './chat-storage.js'
import type { TurnPluginEntry } from './plugin-types.js'
import {
  attachReceiveIdToTurnPluginEntries,
  mergeTurnPluginEntry,
  removeTurnPluginEntriesForReceive,
} from './turn-plugin-utils.js'

function receiveContentFingerprint(
  receives: Pick<TurnReceive, 'id' | 'content'>[],
): string {
  return receives
    .map((r) => {
      const id = typeof r.id === 'string' ? r.id.trim() : ''
      const content = typeof r.content === 'string' ? r.content : ''
      return `${id}\0${content}`
    })
    .join('\n')
}

/** 滑动只改 activeReceiveIndex 时正文不变，无需重同步 plugins */
export function turnReceivesContentUnchanged(
  existing: Pick<TurnReceive, 'id' | 'content'>[] | undefined,
  next: Pick<TurnReceive, 'id' | 'content'>[],
): boolean {
  const a = Array.isArray(existing) ? existing : []
  if (a.length !== next.length) return false
  return receiveContentFingerprint(a) === receiveContentFingerprint(next)
}

/**
 * PATCH / 编辑后：按各 receive 正文重解析插件 turn 快照并同步 turn.plugins[]。
 * - 插件返回条目 → 合并（补 receiveId）
 * - 插件返回 `[]` → 清除该 receive 下该插件（receive-scoped）
 * - 插件返回 `null` → 跳过（保留既有快照；工具模式禁止用 live 覆盖 swipe）
 */
export async function buildSyncedTurnPluginsFromReceives(
  existingPlugins: unknown[] | undefined,
  receives: Pick<TurnReceive, 'id' | 'content'>[],
  conversationId: string,
): Promise<TurnPluginEntry[]> {
  let plugins: TurnPluginEntry[] = Array.isArray(existingPlugins)
    ? (existingPlugins as TurnPluginEntry[])
    : []

  const loaded = await loadEnabledServerPlugins()
  const resolvers = loaded.filter(
    (p) => typeof p.module.resolveTurnPluginEntriesFromAssistant === 'function',
  )
  if (resolvers.length === 0) return plugins

  for (const rec of receives) {
    const receiveId = typeof rec.id === 'string' ? rec.id.trim() : ''
    if (!receiveId) continue
    const content = typeof rec.content === 'string' ? rec.content : ''

    const resolvedAll: TurnPluginEntry[] = []
    const clearedPluginIds: string[] = []

    for (const p of resolvers) {
      const api = createPluginServerHostApi(p.id)
      try {
        const result = await p.module.resolveTurnPluginEntriesFromAssistant!(
          {
            assistantContent: content,
            conversationId,
            receiveContentSync: true,
          },
          api,
        )
        if (result == null) continue
        if (!Array.isArray(result) || result.length === 0) {
          if (getTurnPluginMergePolicy(p.id).mode === 'receive-scoped') {
            clearedPluginIds.push(p.id)
          }
          continue
        }
        for (const entry of result) {
          if (entry && entry.pluginId === p.id) resolvedAll.push(entry)
        }
      } catch (e) {
        console.warn(
          `[buildSyncedTurnPluginsFromReceives:${p.id}]`,
          e instanceof Error ? e.message : e,
        )
      }
    }

    const attached =
      attachReceiveIdToTurnPluginEntries(resolvedAll, receiveId) ?? []
    for (const entry of attached) {
      plugins = mergeTurnPluginEntry(plugins, entry) as TurnPluginEntry[]
    }
    for (const pluginId of clearedPluginIds) {
      plugins = removeTurnPluginEntriesForReceive(
        plugins,
        receiveId,
        pluginId,
      ) as TurnPluginEntry[]
    }
  }

  return plugins
}
