/** 与 server/src/memory-settings.ts 对齐（Web 展示用） */

export interface MemorySettings {
  memoryEnabled: boolean
  memoryTopK: number
}

export const MEMORY_SETTINGS_DEFAULTS: MemorySettings = {
  memoryEnabled: false,
  memoryTopK: 4,
}

export const MEMORY_TOPK_MIN = 1
export const MEMORY_TOPK_MAX = 20

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
  if (Object.prototype.hasOwnProperty.call(override, 'memoryEnabled')) {
    patch.memoryEnabled = override.memoryEnabled === true
  }
  if (Object.prototype.hasOwnProperty.call(override, 'memoryTopK')) {
    patch.memoryTopK = override.memoryTopK
  }
  return normalizeMemorySettings({ ...g, ...patch })
}
