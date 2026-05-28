/** 与 server/src/lorebook-settings.ts 对齐（Web 展示用） */

export interface LorebookSettings {
  recursiveEnabled: boolean
  maxRecursionDepth: number
}

export const LOREBOOK_SETTINGS_DEFAULTS: LorebookSettings = {
  recursiveEnabled: false,
  maxRecursionDepth: 2,
}

export const LOREBOOK_MAX_RECURSION_DEPTH = 3

export function normalizeLorebookSettings(
  raw?: Partial<LorebookSettings> | null,
): LorebookSettings {
  const recursiveEnabled = raw?.recursiveEnabled === true
  let depth =
    typeof raw?.maxRecursionDepth === 'number' &&
    Number.isFinite(raw.maxRecursionDepth)
      ? Math.floor(raw.maxRecursionDepth)
      : LOREBOOK_SETTINGS_DEFAULTS.maxRecursionDepth
  depth = Math.max(0, Math.min(LOREBOOK_MAX_RECURSION_DEPTH, depth))
  if (!recursiveEnabled) {
    return { recursiveEnabled: false, maxRecursionDepth: depth }
  }
  return { recursiveEnabled: true, maxRecursionDepth: depth }
}

export function hasLorebookSettingsOverride(
  raw?: Partial<LorebookSettings> | null,
): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
  return (
    Object.prototype.hasOwnProperty.call(raw, 'recursiveEnabled') ||
    Object.prototype.hasOwnProperty.call(raw, 'maxRecursionDepth')
  )
}

/** 全局默认 + 会话稀疏覆盖 → 生效值 */
export function resolveLorebookSettings(
  global: LorebookSettings,
  override?: Partial<LorebookSettings> | null,
): LorebookSettings {
  const g = normalizeLorebookSettings(global)
  if (!override || typeof override !== 'object') return g
  const patch: Partial<LorebookSettings> = {}
  if (Object.prototype.hasOwnProperty.call(override, 'recursiveEnabled')) {
    patch.recursiveEnabled = override.recursiveEnabled === true
  }
  if (Object.prototype.hasOwnProperty.call(override, 'maxRecursionDepth')) {
    patch.maxRecursionDepth = override.maxRecursionDepth
  }
  return normalizeLorebookSettings({ ...g, ...patch })
}
