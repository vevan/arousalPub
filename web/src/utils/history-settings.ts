/** 与 server/src/history-settings.ts 对齐（Web 展示用） */

export interface HistorySettings {
  limitEnabled: boolean
  maxTurns: number
}

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
  raw?: Partial<HistorySettings> | null,
): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
  return (
    Object.prototype.hasOwnProperty.call(raw, 'limitEnabled') ||
    Object.prototype.hasOwnProperty.call(raw, 'maxTurns')
  )
}

export function resolveHistorySettings(
  global: HistorySettings,
  override?: Partial<HistorySettings> | null,
): HistorySettings {
  const g = normalizeHistorySettings(global)
  if (!override || typeof override !== 'object') return g
  const patch: Partial<HistorySettings> = {}
  if (Object.prototype.hasOwnProperty.call(override, 'limitEnabled')) {
    patch.limitEnabled = override.limitEnabled === true
  }
  if (Object.prototype.hasOwnProperty.call(override, 'maxTurns')) {
    patch.maxTurns = override.maxTurns
  }
  return normalizeHistorySettings({ ...g, ...patch })
}
