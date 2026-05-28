/** 资料库关键字匹配 / 递归级联（全局 user-preferences + 会话稀疏覆盖） */

export interface LorebookSettings {
  /** 是否在首轮匹配后用已注入正文继续扫关键字 */
  recursiveEnabled: boolean
  /** 递归轮次上限（0 = 仅首轮）；启用递归时有效，硬顶 3 */
  maxRecursionDepth: number
}

export type LorebookSettingsOverride = Partial<LorebookSettings>

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
  raw?: LorebookSettingsOverride | null,
): boolean {
  if (!raw || typeof raw !== 'object') return false
  return (
    Object.prototype.hasOwnProperty.call(raw, 'recursiveEnabled') ||
    Object.prototype.hasOwnProperty.call(raw, 'maxRecursionDepth')
  )
}

export function resolveLorebookSettings(
  global: LorebookSettings,
  override?: LorebookSettingsOverride | null,
): LorebookSettings {
  const g = normalizeLorebookSettings(global)
  if (!override || typeof override !== 'object') return g
  const patch: LorebookSettingsOverride = {}
  if (Object.prototype.hasOwnProperty.call(override, 'recursiveEnabled')) {
    patch.recursiveEnabled = override.recursiveEnabled === true
  }
  if (Object.prototype.hasOwnProperty.call(override, 'maxRecursionDepth')) {
    patch.maxRecursionDepth = override.maxRecursionDepth
  }
  return normalizeLorebookSettings({ ...g, ...patch })
}

/** 相对全局的差异；无差异则返回 undefined（不写盘） */
export function lorebookSettingsOverrideFromEffective(
  effective: LorebookSettings,
  global: LorebookSettings,
): LorebookSettingsOverride | undefined {
  const o: LorebookSettingsOverride = {}
  if (effective.recursiveEnabled !== global.recursiveEnabled) {
    o.recursiveEnabled = effective.recursiveEnabled
  }
  if (effective.maxRecursionDepth !== global.maxRecursionDepth) {
    o.maxRecursionDepth = effective.maxRecursionDepth
  }
  return Object.keys(o).length > 0 ? o : undefined
}

export function lorebookSettingsForResolve(
  settings: LorebookSettings,
): LorebookSettings {
  const n = normalizeLorebookSettings(settings)
  if (!n.recursiveEnabled) {
    return { recursiveEnabled: false, maxRecursionDepth: 0 }
  }
  return n
}
