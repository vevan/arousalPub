/** 与 server/src/memory-settings.ts 对齐（Web 展示用） */

export interface MemorySettings {
  memoryEnabled: boolean
  memoryTopK: number
  stripPluginBlocks: boolean
  stripBlockTags: string[]
  stripExPrefixElements: boolean
  recallFuseLastAssistant: boolean
  recallUserWeight: number
}

export const MEMORY_SETTINGS_DEFAULTS: MemorySettings = {
  memoryEnabled: false,
  memoryTopK: 4,
  stripPluginBlocks: true,
  stripBlockTags: [],
  stripExPrefixElements: false,
  recallFuseLastAssistant: true,
  recallUserWeight: 0.85,
}

export const MEMORY_TOPK_MIN = 1
export const MEMORY_TOPK_MAX = 20
export const MEMORY_RECALL_USER_WEIGHT_MIN = 0
export const MEMORY_RECALL_USER_WEIGHT_MAX = 1

function normalizeStripBlockTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const t = item.trim()
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

function normalizeRecallUserWeight(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return MEMORY_SETTINGS_DEFAULTS.recallUserWeight
  }
  return Math.max(
    MEMORY_RECALL_USER_WEIGHT_MIN,
    Math.min(MEMORY_RECALL_USER_WEIGHT_MAX, raw),
  )
}

export function normalizeMemorySettings(
  raw?: Partial<MemorySettings> | null,
): MemorySettings {
  const memoryEnabled = raw?.memoryEnabled === true
  let memoryTopK =
    typeof raw?.memoryTopK === 'number' && Number.isFinite(raw.memoryTopK)
      ? Math.floor(raw.memoryTopK)
      : MEMORY_SETTINGS_DEFAULTS.memoryTopK
  memoryTopK = Math.max(MEMORY_TOPK_MIN, Math.min(MEMORY_TOPK_MAX, memoryTopK))
  const stripPluginBlocks =
    raw?.stripPluginBlocks !== undefined
      ? raw.stripPluginBlocks === true
      : MEMORY_SETTINGS_DEFAULTS.stripPluginBlocks
  const stripBlockTags = normalizeStripBlockTags(raw?.stripBlockTags)
  const stripExPrefixElements =
    raw?.stripExPrefixElements !== undefined
      ? raw.stripExPrefixElements === true
      : MEMORY_SETTINGS_DEFAULTS.stripExPrefixElements
  const recallFuseLastAssistant =
    raw?.recallFuseLastAssistant !== undefined
      ? raw.recallFuseLastAssistant === true
      : MEMORY_SETTINGS_DEFAULTS.recallFuseLastAssistant
  const recallUserWeight = normalizeRecallUserWeight(raw?.recallUserWeight)
  return {
    memoryEnabled,
    memoryTopK,
    stripPluginBlocks,
    stripBlockTags,
    stripExPrefixElements,
    recallFuseLastAssistant,
    recallUserWeight,
  }
}

export function hasMemorySettingsOverride(
  raw?: Partial<MemorySettings> | null,
): boolean {
  return raw != null && typeof raw === 'object' && !Array.isArray(raw)
}

export function resolveMemorySettings(
  global: MemorySettings,
  override?: Partial<MemorySettings> | null,
): MemorySettings {
  const g = normalizeMemorySettings(global)
  if (!override || typeof override !== 'object') return g
  const patch: Partial<MemorySettings> = {}
  for (const key of [
    'memoryEnabled',
    'memoryTopK',
    'stripPluginBlocks',
    'stripBlockTags',
    'stripExPrefixElements',
    'recallFuseLastAssistant',
    'recallUserWeight',
  ] as const) {
    if (Object.prototype.hasOwnProperty.call(override, key)) {
      ;(patch as Record<string, unknown>)[key] = override[key]
    }
  }
  return normalizeMemorySettings({ ...g, ...patch })
}

/** 表单：逗号/换行分隔的标签列表 */
export function stripBlockTagsFromText(raw: string): string[] {
  return normalizeStripBlockTags(
    raw
      .split(/[,，\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  )
}

export function stripBlockTagsToText(tags: string[]): string {
  return tags.join(', ')
}

export function memorySettingsEqual(a: MemorySettings, b: MemorySettings): boolean {
  if (a.memoryEnabled !== b.memoryEnabled) return false
  if (a.memoryTopK !== b.memoryTopK) return false
  if (a.stripPluginBlocks !== b.stripPluginBlocks) return false
  if (a.stripExPrefixElements !== b.stripExPrefixElements) return false
  if (a.recallFuseLastAssistant !== b.recallFuseLastAssistant) return false
  if (a.recallUserWeight !== b.recallUserWeight) return false
  if (a.stripBlockTags.length !== b.stripBlockTags.length) return false
  return a.stripBlockTags.every((tag, i) => tag === b.stripBlockTags[i])
}

export function cloneMemorySettings(s: MemorySettings): MemorySettings {
  return {
    ...s,
    stripBlockTags: [...s.stripBlockTags],
  }
}
