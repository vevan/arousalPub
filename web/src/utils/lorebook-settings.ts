/** 与 server/src/lorebook-settings.ts 对齐（Web 展示用） */

export interface LorebookSettings {
  recursiveEnabled: boolean
  maxRecursionDepth: number
  vectorEnabled: boolean
  vectorTopK: number
}

export const LOREBOOK_SETTINGS_DEFAULTS: LorebookSettings = {
  recursiveEnabled: false,
  maxRecursionDepth: 2,
  vectorEnabled: false,
  vectorTopK: 5,
}

export const LOREBOOK_MAX_RECURSION_DEPTH = 3
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
    return { recursiveEnabled: false, maxRecursionDepth: depth, vectorEnabled, vectorTopK }
  }
  return { recursiveEnabled: true, maxRecursionDepth: depth, vectorEnabled, vectorTopK }
}

export function hasLorebookSettingsOverride(
  raw?: Partial<LorebookSettings> | null,
): boolean {
  return raw != null && typeof raw === 'object' && !Array.isArray(raw)
}

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
  if (Object.prototype.hasOwnProperty.call(override, 'vectorEnabled')) {
    patch.vectorEnabled = override.vectorEnabled === true
  }
  if (Object.prototype.hasOwnProperty.call(override, 'vectorTopK')) {
    patch.vectorTopK = override.vectorTopK
  }
  return normalizeLorebookSettings({ ...g, ...patch })
}
