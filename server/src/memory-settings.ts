/** 对话记忆（向量召回）全局 + 会话稀疏覆盖 */

export interface MemorySettings {
  /** 是否启用远期记忆向量召回 */
  memoryEnabled: boolean
  /** Lance TopK */
  memoryTopK: number
  /** 入库与召回前剥离插件块（manifest 标签 + stripBlockTags） */
  stripPluginBlocks: boolean
  /** 用户额外剥离标签（与已启用插件 manifest 合并） */
  stripBlockTags: string[]
  /** 召回向量是否融合上一轮助手 */
  recallFuseLastAssistant: boolean
  /** 召回向量用户权重 α∈[0,1]；1=仅用户 */
  recallUserWeight: number
}

export type MemorySettingsOverride = Partial<MemorySettings>

export const MEMORY_SETTINGS_DEFAULTS: MemorySettings = {
  memoryEnabled: false,
  memoryTopK: 4,
  stripPluginBlocks: true,
  stripBlockTags: [],
  recallFuseLastAssistant: true,
  recallUserWeight: 0.85,
}

export const MEMORY_TOPK_MIN = 1
export const MEMORY_TOPK_MAX = 20
export const MEMORY_RECALL_USER_WEIGHT_MIN = 0
export const MEMORY_RECALL_USER_WEIGHT_MAX = 1

/** limitEnabled=false 时 history XML 默认窗口轮数 */
export const HISTORY_XML_DEFAULT_TURNS = 16

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
    recallFuseLastAssistant,
    recallUserWeight,
  }
}

export function hasMemorySettingsOverride(
  raw?: MemorySettingsOverride | null,
): boolean {
  return raw != null && typeof raw === 'object' && !Array.isArray(raw)
}

export function resolveMemorySettings(
  global: MemorySettings,
  override?: MemorySettingsOverride | null,
): MemorySettings {
  const g = normalizeMemorySettings(global)
  if (!override || typeof override !== 'object') return g
  const patch: MemorySettingsOverride = {}
  for (const key of [
    'memoryEnabled',
    'memoryTopK',
    'stripPluginBlocks',
    'stripBlockTags',
    'recallFuseLastAssistant',
    'recallUserWeight',
  ] as const) {
    if (Object.prototype.hasOwnProperty.call(override, key)) {
      ;(patch as Record<string, unknown>)[key] = override[key]
    }
  }
  return normalizeMemorySettings({ ...g, ...patch })
}

export function memorySettingsOverrideFromEffective(
  effective: MemorySettings,
  global: MemorySettings,
): MemorySettingsOverride | undefined {
  const o: MemorySettingsOverride = {}
  if (effective.memoryEnabled !== global.memoryEnabled) {
    o.memoryEnabled = effective.memoryEnabled
  }
  if (effective.memoryTopK !== global.memoryTopK) {
    o.memoryTopK = effective.memoryTopK
  }
  if (effective.stripPluginBlocks !== global.stripPluginBlocks) {
    o.stripPluginBlocks = effective.stripPluginBlocks
  }
  if (
    JSON.stringify(effective.stripBlockTags) !==
    JSON.stringify(global.stripBlockTags)
  ) {
    o.stripBlockTags = [...effective.stripBlockTags]
  }
  if (effective.recallFuseLastAssistant !== global.recallFuseLastAssistant) {
    o.recallFuseLastAssistant = effective.recallFuseLastAssistant
  }
  if (effective.recallUserWeight !== global.recallUserWeight) {
    o.recallUserWeight = effective.recallUserWeight
  }
  return Object.keys(o).length > 0 ? o : undefined
}

export type MemorySettingsPatchError =
  | 'memory_enabled_boolean'
  | 'memory_top_k_number'
  | 'memory_settings_memory_enabled_boolean'
  | 'memory_settings_memory_top_k_number'
  | 'memory_strip_plugin_blocks_boolean'
  | 'memory_strip_block_tags_invalid'
  | 'memory_recall_fuse_last_assistant_boolean'
  | 'memory_recall_user_weight_number'
  | 'memory_settings_requires_field'
  | 'global_memory_requires_field'

export function parseMemorySettingsPatch(
  raw: unknown,
  mode: 'global' | 'conversation',
):
  | { ok: true; patch: MemorySettingsOverride }
  | { ok: false; error: MemorySettingsPatchError } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      error:
        mode === 'global'
          ? 'global_memory_requires_field'
          : 'memory_settings_requires_field',
    }
  }
  const b = raw as Record<string, unknown>
  const patch: MemorySettingsOverride = {}

  if (Object.prototype.hasOwnProperty.call(b, 'memoryEnabled')) {
      if (typeof b.memoryEnabled !== 'boolean') {
        return {
          ok: false,
          error:
            mode === 'conversation'
              ? 'memory_settings_memory_enabled_boolean'
              : 'memory_enabled_boolean',
        }
      }
      patch.memoryEnabled = b.memoryEnabled
    }
    if (Object.prototype.hasOwnProperty.call(b, 'memoryTopK')) {
      const d = b.memoryTopK
      if (typeof d !== 'number' || !Number.isFinite(d)) {
        return {
          ok: false,
          error:
            mode === 'conversation'
              ? 'memory_settings_memory_top_k_number'
              : 'memory_top_k_number',
        }
      }
      patch.memoryTopK = d
    }
    if (Object.prototype.hasOwnProperty.call(b, 'stripPluginBlocks')) {
      if (typeof b.stripPluginBlocks !== 'boolean') {
        return { ok: false, error: 'memory_strip_plugin_blocks_boolean' }
      }
      patch.stripPluginBlocks = b.stripPluginBlocks
    }
    if (Object.prototype.hasOwnProperty.call(b, 'stripBlockTags')) {
      const tags = b.stripBlockTags
      if (
        !Array.isArray(tags) ||
        tags.some((t) => typeof t !== 'string')
      ) {
        return { ok: false, error: 'memory_strip_block_tags_invalid' }
      }
      patch.stripBlockTags = normalizeStripBlockTags(tags)
    }
    if (Object.prototype.hasOwnProperty.call(b, 'recallFuseLastAssistant')) {
      if (typeof b.recallFuseLastAssistant !== 'boolean') {
        return { ok: false, error: 'memory_recall_fuse_last_assistant_boolean' }
      }
      patch.recallFuseLastAssistant = b.recallFuseLastAssistant
    }
    if (Object.prototype.hasOwnProperty.call(b, 'recallUserWeight')) {
      const w = b.recallUserWeight
      if (typeof w !== 'number' || !Number.isFinite(w)) {
        return { ok: false, error: 'memory_recall_user_weight_number' }
      }
      patch.recallUserWeight = w
    }

  if (Object.keys(patch).length === 0) {
    return {
      ok: false,
      error:
        mode === 'global'
          ? 'global_memory_requires_field'
          : 'memory_settings_requires_field',
    }
  }
  return { ok: true, patch }
}
