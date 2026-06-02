import type { TurnPluginEntry } from './plugin-types.js'

export function mergeTurnPluginEntry(
  existing: unknown[] | undefined,
  entry: TurnPluginEntry,
): unknown[] {
  const out: unknown[] = []
  for (const raw of existing ?? []) {
    if (!raw || typeof raw !== 'object') {
      out.push(raw)
      continue
    }
    const pluginId = (raw as { pluginId?: unknown }).pluginId
    if (typeof pluginId === 'string' && pluginId === entry.pluginId) {
      continue
    }
    out.push(raw)
  }
  out.push(entry)
  return out
}
