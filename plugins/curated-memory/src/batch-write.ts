import type { PluginHost } from './types.js'

export interface PendingLorebookCreate {
  body: Record<string, unknown>
  /** 新建 sidecar 条目时回填 sidecarEntryIds */
  sidecarId?: string
}

/** 将本轮累积的新建条目一次性落盘（1 读 + 1 写） */
export async function flushPendingLorebookCreates(
  host: PluginHost,
  lorebookId: string,
  pending: PendingLorebookCreate[],
  sidecarEntryIds: Record<string, string>,
): Promise<void> {
  if (!pending.length) return
  if (typeof host.lorebook.createEntriesBatch !== 'function') {
    for (const item of pending) {
      const created = await host.lorebook.createEntry(lorebookId, item.body)
      if (item.sidecarId) sidecarEntryIds[item.sidecarId] = created.id
    }
    pending.length = 0
    return
  }
  const created = await host.lorebook.createEntriesBatch(
    lorebookId,
    pending.map((p) => p.body),
  )
  for (let i = 0; i < created.length; i++) {
    const sidecarId = pending[i]?.sidecarId
    if (sidecarId && created[i]?.id) {
      sidecarEntryIds[sidecarId] = created[i]!.id
    }
  }
  pending.length = 0
}
