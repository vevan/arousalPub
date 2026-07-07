import { parseObjectListField } from '@/utils/plugin-settings-validate'

export type InheritTriMode = 'inherit' | 'on' | 'off'

export function parseSheetOverrides(
  model: Record<string, unknown>,
): Record<string, boolean> {
  const raw = model.sheetOverrides
  if (raw == null || raw === '') return {}
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, boolean>
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {}
      }
      return parsed as Record<string, boolean>
    } catch {
      return {}
    }
  }
  return {}
}

export function inheritTriModeForBoolean(
  model: Record<string, unknown>,
  key: string,
): InheritTriMode {
  const v = model[key]
  if (v === true) return 'on'
  if (v === false) return 'off'
  return 'inherit'
}

export function inheritTriModeForSheet(
  model: Record<string, unknown>,
  sheetId: string,
): InheritTriMode {
  const overrides = parseSheetOverrides(model)
  if (!Object.prototype.hasOwnProperty.call(overrides, sheetId)) {
    return 'inherit'
  }
  return overrides[sheetId] === true ? 'on' : 'off'
}

export function applyInheritTriModeBoolean(
  model: Record<string, unknown>,
  key: string,
  mode: InheritTriMode,
): Record<string, unknown> {
  const next = { ...model }
  if (mode === 'inherit') {
    delete next[key]
  } else {
    next[key] = mode === 'on'
  }
  return next
}

export function applyInheritTriModeSheet(
  model: Record<string, unknown>,
  sheetId: string,
  mode: InheritTriMode,
): Record<string, unknown> {
  const overrides = { ...parseSheetOverrides(model) }
  if (mode === 'inherit') {
    delete overrides[sheetId]
  } else {
    overrides[sheetId] = mode === 'on'
  }
  const next = { ...model }
  if (Object.keys(overrides).length === 0) {
    delete next.sheetOverrides
  } else {
    next.sheetOverrides = JSON.stringify(overrides)
  }
  return next
}

export function globalSheetsFromSettings(
  globalModel: Record<string, unknown> | undefined,
  listFieldKey: string,
): Record<string, unknown>[] {
  return parseObjectListField(globalModel?.[listFieldKey])
}

export function globalBooleanOn(
  globalModel: Record<string, unknown> | undefined,
  key: string,
): boolean {
  return globalModel?.[key] !== false
}

export function globalSheetEnabledLabel(
  sheet: Record<string, unknown>,
  onLabel: string,
  offLabel: string,
): string {
  return sheet.enabled !== false ? onLabel : offLabel
}

export function sheetTitle(sheet: Record<string, unknown>, index: number): string {
  const name = typeof sheet.name === 'string' ? sheet.name.trim() : ''
  return name || `#${index + 1}`
}
