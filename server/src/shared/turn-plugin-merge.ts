/** turn.plugins[] merge 策略（宿主 generic · DOC/41 / DOC/42） */

export type TurnPluginMergeMode = 'replace-by-plugin-id' | 'receive-scoped'

export type TurnPluginMergePolicy = {
  mode: TurnPluginMergeMode
  /** payload 内 receive 键名，默认 `receiveId` */
  receiveIdKey?: string
}

export type TurnPluginEntryLike = {
  pluginId: string
  schemaVersion?: number
  payload?: Record<string, unknown>
}

export const DEFAULT_TURN_PLUGIN_MERGE_POLICY: TurnPluginMergePolicy = {
  mode: 'replace-by-plugin-id',
}

function receiveIdFromPayload(
  payload: Record<string, unknown> | undefined,
  key: string,
): string {
  const raw = payload?.[key]
  return typeof raw === 'string' ? raw.trim() : ''
}

export function mergeTurnPluginEntryWithPolicy(
  existing: unknown[] | undefined,
  entry: TurnPluginEntryLike,
  policy: TurnPluginMergePolicy = DEFAULT_TURN_PLUGIN_MERGE_POLICY,
): unknown[] {
  if (policy.mode !== 'receive-scoped') {
    const out: unknown[] = []
    for (const raw of existing ?? []) {
      if (!raw || typeof raw !== 'object') {
        out.push(raw)
        continue
      }
      const pluginId = (raw as { pluginId?: unknown }).pluginId
      if (typeof pluginId === 'string' && pluginId === entry.pluginId) continue
      out.push(raw)
    }
    out.push(entry)
    return out
  }

  const receiveIdKey = policy.receiveIdKey?.trim() || 'receiveId'
  const entryReceiveId = receiveIdFromPayload(entry.payload, receiveIdKey)
  const out: unknown[] = []
  for (const raw of existing ?? []) {
    if (!raw || typeof raw !== 'object') {
      out.push(raw)
      continue
    }
    const pluginId = (raw as { pluginId?: unknown }).pluginId
    if (typeof pluginId !== 'string' || pluginId !== entry.pluginId) {
      out.push(raw)
      continue
    }

    const prevPayload =
      (raw as { payload?: unknown }).payload &&
      typeof (raw as { payload?: unknown }).payload === 'object' &&
      !Array.isArray((raw as { payload?: unknown }).payload)
        ? (raw as { payload: Record<string, unknown> }).payload
        : undefined
    const prevReceiveId = receiveIdFromPayload(prevPayload, receiveIdKey)

    if (entryReceiveId) {
      if (prevReceiveId === entryReceiveId) continue
      out.push(raw)
      continue
    }

    if (prevReceiveId) {
      out.push(raw)
      continue
    }

    continue
  }
  out.push(entry)
  return out
}

export function attachReceiveIdToTurnPluginEntriesWithPolicy(
  entries: TurnPluginEntryLike[] | undefined,
  receiveId: string,
  policyForPlugin: (pluginId: string) => TurnPluginMergePolicy,
): TurnPluginEntryLike[] | undefined {
  const rid = receiveId.trim()
  if (!rid || !entries?.length) return entries
  return entries.map((entry) => {
    const policy = policyForPlugin(entry.pluginId)
    if (policy.mode !== 'receive-scoped') return entry
    const key = policy.receiveIdKey?.trim() || 'receiveId'
    if (receiveIdFromPayload(entry.payload, key)) return entry
    return {
      ...entry,
      payload: { ...entry.payload, [key]: rid },
    }
  })
}

export function removeReceiveScopedTurnPluginForReceive(
  existing: unknown[] | undefined,
  receiveId: string,
  pluginId: string,
  policy: TurnPluginMergePolicy,
): unknown[] {
  if (policy.mode !== 'receive-scoped') {
    return Array.isArray(existing) ? [...existing] : []
  }
  const rid = receiveId.trim()
  if (!rid) return Array.isArray(existing) ? [...existing] : []
  const receiveIdKey = policy.receiveIdKey?.trim() || 'receiveId'
  const out: unknown[] = []
  for (const raw of existing ?? []) {
    if (!raw || typeof raw !== 'object') {
      out.push(raw)
      continue
    }
    if ((raw as { pluginId?: unknown }).pluginId !== pluginId) {
      out.push(raw)
      continue
    }
    const payload =
      (raw as { payload?: unknown }).payload &&
      typeof (raw as { payload?: unknown }).payload === 'object' &&
      !Array.isArray((raw as { payload?: unknown }).payload)
        ? (raw as { payload: Record<string, unknown> }).payload
        : undefined
    if (receiveIdFromPayload(payload, receiveIdKey) === rid) continue
    out.push(raw)
  }
  return out
}
