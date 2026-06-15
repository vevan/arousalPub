/** 资料库关键字匹配 / 递归级联 / 向量触发（全局 user-preferences + 会话稀疏覆盖） */

export interface LorebookSettings {
  /** 是否在首轮匹配后用已注入正文继续扫关键字 */
  recursiveEnabled: boolean
  /** 递归轮次上限（0 = 仅首轮）；启用递归时有效，硬顶 3 */
  maxRecursionDepth: number
  /** 关键字匹配最多注入条数（与 vectorTopK 独立） */
  keywordTopK: number
  /** 是否启用「向量触发」条目检索 */
  vectorEnabled: boolean
  /** 向量触发 TopK（跨绑定资料库合并后取前 K；与 keywordTopK 独立） */
  vectorTopK: number
}

export type LorebookSettingsOverride = Partial<LorebookSettings>

export const LOREBOOK_SETTINGS_DEFAULTS: LorebookSettings = {
  recursiveEnabled: false,
  maxRecursionDepth: 2,
  keywordTopK: 64,
  vectorEnabled: false,
  vectorTopK: 5,
}

export const LOREBOOK_MAX_RECURSION_DEPTH = 3
export const LOREBOOK_KEYWORD_TOPK_MIN = 1
export const LOREBOOK_KEYWORD_TOPK_MAX = 64
export const LOREBOOK_VECTOR_TOPK_MIN = 1
export const LOREBOOK_VECTOR_TOPK_MAX = 20

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
  let keywordTopK =
    typeof raw?.keywordTopK === 'number' && Number.isFinite(raw.keywordTopK)
      ? Math.floor(raw.keywordTopK)
      : LOREBOOK_SETTINGS_DEFAULTS.keywordTopK
  keywordTopK = Math.max(
    LOREBOOK_KEYWORD_TOPK_MIN,
    Math.min(LOREBOOK_KEYWORD_TOPK_MAX, keywordTopK),
  )
  const vectorEnabled = raw?.vectorEnabled === true
  let vectorTopK =
    typeof raw?.vectorTopK === 'number' && Number.isFinite(raw.vectorTopK)
      ? Math.floor(raw.vectorTopK)
      : LOREBOOK_SETTINGS_DEFAULTS.vectorTopK
  vectorTopK = Math.max(
    LOREBOOK_VECTOR_TOPK_MIN,
    Math.min(LOREBOOK_VECTOR_TOPK_MAX, vectorTopK),
  )
  if (!recursiveEnabled) {
    return {
      recursiveEnabled: false,
      maxRecursionDepth: depth,
      keywordTopK,
      vectorEnabled,
      vectorTopK,
    }
  }
  return {
    recursiveEnabled: true,
    maxRecursionDepth: depth,
    keywordTopK,
    vectorEnabled,
    vectorTopK,
  }
}

export function hasLorebookSettingsOverride(
  raw?: LorebookSettingsOverride | null,
): boolean {
  return raw != null && typeof raw === 'object' && !Array.isArray(raw)
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
  if (Object.prototype.hasOwnProperty.call(override, 'keywordTopK')) {
    patch.keywordTopK = override.keywordTopK
  }
  if (Object.prototype.hasOwnProperty.call(override, 'vectorEnabled')) {
    patch.vectorEnabled = override.vectorEnabled === true
  }
  if (Object.prototype.hasOwnProperty.call(override, 'vectorTopK')) {
    patch.vectorTopK = override.vectorTopK
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
  if (effective.keywordTopK !== global.keywordTopK) {
    o.keywordTopK = effective.keywordTopK
  }
  if (effective.vectorEnabled !== global.vectorEnabled) {
    o.vectorEnabled = effective.vectorEnabled
  }
  if (effective.vectorTopK !== global.vectorTopK) {
    o.vectorTopK = effective.vectorTopK
  }
  return Object.keys(o).length > 0 ? o : undefined
}

export function lorebookSettingsForResolve(
  settings: LorebookSettings,
): LorebookSettings {
  const n = normalizeLorebookSettings(settings)
  if (!n.recursiveEnabled) {
    return {
      recursiveEnabled: false,
      maxRecursionDepth: 0,
      keywordTopK: n.keywordTopK,
      vectorEnabled: n.vectorEnabled,
      vectorTopK: n.vectorTopK,
    }
  }
  return n
}
