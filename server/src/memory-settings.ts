/** 对话记忆（向量召回）全局 + 会话稀疏覆盖 */

export interface MemorySettings {
  /** 是否启用远期记忆向量召回 */
  memoryEnabled: boolean
  /** Lance TopK */
  memoryTopK: number
}

export type MemorySettingsOverride = Partial<MemorySettings>

export const MEMORY_SETTINGS_DEFAULTS: MemorySettings = {
  memoryEnabled: false,
  memoryTopK: 4,
}

export const MEMORY_TOPK_MIN = 1
export const MEMORY_TOPK_MAX = 20

/** limitEnabled=false 时 history XML 默认窗口轮数 */
export const HISTORY_XML_DEFAULT_TURNS = 16

export function normalizeMemorySettings(
  raw?: Partial<MemorySettings> | null,
): MemorySettings {
  const memoryEnabled = raw?.memoryEnabled === true
  let memoryTopK =
    typeof raw?.memoryTopK === 'number' && Number.isFinite(raw.memoryTopK)
      ? Math.floor(raw.memoryTopK)
      : MEMORY_SETTINGS_DEFAULTS.memoryTopK
  memoryTopK = Math.max(MEMORY_TOPK_MIN, Math.min(MEMORY_TOPK_MAX, memoryTopK))
  return { memoryEnabled, memoryTopK }
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
  if (Object.prototype.hasOwnProperty.call(override, 'memoryEnabled')) {
    patch.memoryEnabled = override.memoryEnabled === true
  }
  if (Object.prototype.hasOwnProperty.call(override, 'memoryTopK')) {
    patch.memoryTopK = override.memoryTopK
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
  return Object.keys(o).length > 0 ? o : undefined
}
