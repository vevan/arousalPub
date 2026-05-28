/** 对话历史注入轮数（全局 user-preferences + 会话稀疏覆盖） */

export interface HistorySettings {
  /** true：仅注入最近 maxTurns 轮；false：不限制轮数，由 context/token 裁切 */
  limitEnabled: boolean
  /** limitEnabled 时生效；对话「轮」= 一条 turn（含 user + assistant） */
  maxTurns: number
}

export type HistorySettingsOverride = Partial<HistorySettings>

export const HISTORY_SETTINGS_DEFAULTS: HistorySettings = {
  limitEnabled: false,
  maxTurns: 20,
}

export const HISTORY_MAX_TURNS = 200

export function normalizeHistorySettings(
  raw?: Partial<HistorySettings> | null,
): HistorySettings {
  const limitEnabled = raw?.limitEnabled === true
  let maxTurns =
    typeof raw?.maxTurns === 'number' && Number.isFinite(raw.maxTurns)
      ? Math.floor(raw.maxTurns)
      : HISTORY_SETTINGS_DEFAULTS.maxTurns
  maxTurns = Math.max(1, Math.min(HISTORY_MAX_TURNS, maxTurns))
  return { limitEnabled, maxTurns }
}

export function hasHistorySettingsOverride(
  raw?: HistorySettingsOverride | null,
): boolean {
  if (!raw || typeof raw !== 'object') return false
  return (
    Object.prototype.hasOwnProperty.call(raw, 'limitEnabled') ||
    Object.prototype.hasOwnProperty.call(raw, 'maxTurns')
  )
}

export function resolveHistorySettings(
  global: HistorySettings,
  override?: HistorySettingsOverride | null,
): HistorySettings {
  const g = normalizeHistorySettings(global)
  if (!override || typeof override !== 'object') return g
  const patch: HistorySettingsOverride = {}
  if (Object.prototype.hasOwnProperty.call(override, 'limitEnabled')) {
    patch.limitEnabled = override.limitEnabled === true
  }
  if (Object.prototype.hasOwnProperty.call(override, 'maxTurns')) {
    patch.maxTurns = override.maxTurns
  }
  return normalizeHistorySettings({ ...g, ...patch })
}

export function historySettingsOverrideFromEffective(
  effective: HistorySettings,
  global: HistorySettings,
): HistorySettingsOverride | undefined {
  const o: HistorySettingsOverride = {}
  if (effective.limitEnabled !== global.limitEnabled) {
    o.limitEnabled = effective.limitEnabled
  }
  if (effective.maxTurns !== global.maxTurns) {
    o.maxTurns = effective.maxTurns
  }
  return Object.keys(o).length > 0 ? o : undefined
}

/** 在已按 turnOrdinal 排序的 turn 列表上应用轮数上限 */
export function limitHistoryTurnRows<T extends { turnOrdinal: number }>(
  rows: T[],
  settings: HistorySettings,
): T[] {
  if (!settings.limitEnabled || rows.length === 0) return rows
  const n = Math.max(1, Math.min(HISTORY_MAX_TURNS, Math.floor(settings.maxTurns)))
  if (rows.length <= n) return rows
  return rows.slice(-n)
}
