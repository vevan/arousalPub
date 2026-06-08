/** 规范化 sidecar 配置 id → lorebook entry id 映射（插件 prepare / reorder 共用） */
export function normalizeSidecarEntryIds(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k !== 'string' || typeof v !== 'string') continue
    const key = k.trim()
    const id = v.trim()
    if (!key || !id) continue
    out[key] = id
  }
  return out
}

/** 规范化 sidecar 配置 id 顺序列表 */
export function normalizeSidecarConfigIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim())
    .filter(Boolean)
}
