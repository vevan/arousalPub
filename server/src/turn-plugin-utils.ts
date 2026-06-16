import type { TurnPluginEntry } from './plugin-types.js'

const TRACE_KEEPER_PLUGIN_ID = 'trace-keeper'

function payloadReceiveId(payload: Record<string, unknown> | undefined): string {
  const raw = payload?.receiveId
  return typeof raw === 'string' ? raw.trim() : ''
}

export function mergeTurnPluginEntry(
  existing: unknown[] | undefined,
  entry: TurnPluginEntry,
): unknown[] {
  const entryReceiveId = payloadReceiveId(entry.payload)
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

    if (entry.pluginId !== TRACE_KEEPER_PLUGIN_ID) {
      continue
    }

    const prevPayload =
      (raw as { payload?: unknown }).payload &&
      typeof (raw as { payload?: unknown }).payload === 'object' &&
      !Array.isArray((raw as { payload?: unknown }).payload)
        ? (raw as { payload: Record<string, unknown> }).payload
        : undefined
    const prevReceiveId = payloadReceiveId(prevPayload)

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

/** persist 落盘前为 trace-keeper 条目补上 receiveId */
export function attachReceiveIdToTurnPluginEntries(
  entries: TurnPluginEntry[] | undefined,
  receiveId: string,
): TurnPluginEntry[] | undefined {
  const rid = receiveId.trim()
  if (!rid || !entries?.length) return entries
  return entries.map((entry) => {
    if (entry.pluginId !== TRACE_KEEPER_PLUGIN_ID) return entry
    if (payloadReceiveId(entry.payload)) return entry
    return {
      ...entry,
      payload: { ...entry.payload, receiveId: rid },
    }
  })
}
