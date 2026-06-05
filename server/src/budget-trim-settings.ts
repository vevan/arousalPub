/** §14.4.1 预算裁切：全局 user-preferences + 会话稀疏覆盖 */

export type BudgetTrimSlot = 'lore' | 'memory' | 'history'

export const BUDGET_TRIM_SLOTS: readonly BudgetTrimSlot[] = [
  'lore',
  'memory',
  'history',
]

export interface BudgetTrimMinRetain {
  lore: number
  memory: number
  history: number
}

export interface BudgetTrimSettings {
  trimOrder: BudgetTrimSlot[]
  minRetain: BudgetTrimMinRetain
}

export type BudgetTrimSettingsOverride = Partial<{
  trimOrder: BudgetTrimSlot[]
  minRetain: Partial<BudgetTrimMinRetain>
}>

export const BUDGET_TRIM_SETTINGS_DEFAULTS: BudgetTrimSettings = {
  trimOrder: ['lore', 'memory', 'history'],
  minRetain: { lore: 1, memory: 1, history: 1 },
}

export const MIN_RETAIN_MIN = 0
export const MIN_RETAIN_MAX = 32

function isTrimSlot(x: unknown): x is BudgetTrimSlot {
  return x === 'lore' || x === 'memory' || x === 'history'
}

export function normalizeTrimOrder(raw: unknown): BudgetTrimSlot[] {
  if (!Array.isArray(raw) || raw.length !== 3) {
    return [...BUDGET_TRIM_SETTINGS_DEFAULTS.trimOrder]
  }
  const seen = new Set<BudgetTrimSlot>()
  const out: BudgetTrimSlot[] = []
  for (const item of raw) {
    if (!isTrimSlot(item) || seen.has(item)) {
      return [...BUDGET_TRIM_SETTINGS_DEFAULTS.trimOrder]
    }
    seen.add(item)
    out.push(item)
  }
  if (out.length !== 3) {
    return [...BUDGET_TRIM_SETTINGS_DEFAULTS.trimOrder]
  }
  return out
}

function clampMinRetain(n: unknown, fallback: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback
  return Math.max(MIN_RETAIN_MIN, Math.min(MIN_RETAIN_MAX, Math.floor(n)))
}

export function normalizeBudgetTrimSettings(
  raw?: Partial<BudgetTrimSettings> | null,
): BudgetTrimSettings {
  const defaults = BUDGET_TRIM_SETTINGS_DEFAULTS
  const trimOrder =
    raw && Object.prototype.hasOwnProperty.call(raw, 'trimOrder')
      ? normalizeTrimOrder(raw.trimOrder)
      : [...defaults.trimOrder]
  const minRaw = raw?.minRetain
  const minRetain: BudgetTrimMinRetain = {
    lore:
      minRaw && Object.prototype.hasOwnProperty.call(minRaw, 'lore')
        ? clampMinRetain(minRaw.lore, defaults.minRetain.lore)
        : defaults.minRetain.lore,
    memory:
      minRaw && Object.prototype.hasOwnProperty.call(minRaw, 'memory')
        ? clampMinRetain(minRaw.memory, defaults.minRetain.memory)
        : defaults.minRetain.memory,
    history:
      minRaw && Object.prototype.hasOwnProperty.call(minRaw, 'history')
        ? clampMinRetain(minRaw.history, defaults.minRetain.history)
        : defaults.minRetain.history,
  }
  return { trimOrder, minRetain }
}

export function hasBudgetTrimSettingsOverride(
  raw?: BudgetTrimSettingsOverride | null,
): boolean {
  return raw != null && typeof raw === 'object' && !Array.isArray(raw)
}

export function resolveBudgetTrimSettings(
  global: BudgetTrimSettings,
  override?: BudgetTrimSettingsOverride | null,
): BudgetTrimSettings {
  const g = normalizeBudgetTrimSettings(global)
  if (!override || typeof override !== 'object') return g
  const patch: Partial<BudgetTrimSettings> = {}
  if (Object.prototype.hasOwnProperty.call(override, 'trimOrder')) {
    patch.trimOrder = normalizeTrimOrder(override.trimOrder)
  }
  if (override.minRetain && typeof override.minRetain === 'object') {
    patch.minRetain = {
      lore: Object.prototype.hasOwnProperty.call(override.minRetain, 'lore')
        ? clampMinRetain(override.minRetain.lore, g.minRetain.lore)
        : g.minRetain.lore,
      memory: Object.prototype.hasOwnProperty.call(override.minRetain, 'memory')
        ? clampMinRetain(override.minRetain.memory, g.minRetain.memory)
        : g.minRetain.memory,
      history: Object.prototype.hasOwnProperty.call(
        override.minRetain,
        'history',
      )
        ? clampMinRetain(override.minRetain.history, g.minRetain.history)
        : g.minRetain.history,
    }
  }
  return normalizeBudgetTrimSettings({ ...g, ...patch })
}

export function budgetTrimSettingsOverrideFromEffective(
  effective: BudgetTrimSettings,
  global: BudgetTrimSettings,
): BudgetTrimSettingsOverride | undefined {
  const o: BudgetTrimSettingsOverride = {}
  if (
    effective.trimOrder.length !== global.trimOrder.length ||
    effective.trimOrder.some((s, i) => s !== global.trimOrder[i])
  ) {
    o.trimOrder = [...effective.trimOrder]
  }
  const mr: Partial<BudgetTrimMinRetain> = {}
  if (effective.minRetain.lore !== global.minRetain.lore) {
    mr.lore = effective.minRetain.lore
  }
  if (effective.minRetain.memory !== global.minRetain.memory) {
    mr.memory = effective.minRetain.memory
  }
  if (effective.minRetain.history !== global.minRetain.history) {
    mr.history = effective.minRetain.history
  }
  if (Object.keys(mr).length > 0) {
    o.minRetain = mr
  }
  return Object.keys(o).length > 0 ? o : undefined
}

export function budgetTrimSettingsEqual(
  a: BudgetTrimSettings,
  b: BudgetTrimSettings,
): boolean {
  if (a.minRetain.lore !== b.minRetain.lore) return false
  if (a.minRetain.memory !== b.minRetain.memory) return false
  if (a.minRetain.history !== b.minRetain.history) return false
  if (a.trimOrder.length !== b.trimOrder.length) return false
  return a.trimOrder.every((s, i) => s === b.trimOrder[i])
}

export function isValidTrimOrder(raw: unknown): raw is BudgetTrimSlot[] {
  if (!Array.isArray(raw) || raw.length !== 3) return false
  const seen = new Set<BudgetTrimSlot>()
  for (const item of raw) {
    if (!isTrimSlot(item) || seen.has(item)) return false
    seen.add(item)
  }
  return seen.size === 3
}

export type BudgetTrimPatchParseError =
  | 'budget_trim_settings_invalid'
  | 'budget_trim_settings_requires_field'
  | 'budget_trim_trim_order_invalid'
  | 'budget_trim_min_retain_invalid'
  | 'budget_trim_min_retain_number'
  | 'budget_trim_min_retain_requires_field'

export function parseBudgetTrimSettingsPatch(
  raw: unknown,
): { ok: true; patch: BudgetTrimSettingsOverride } | { ok: false; error: BudgetTrimPatchParseError } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'budget_trim_settings_invalid' }
  }
  const obj = raw as Record<string, unknown>
  const patch: BudgetTrimSettingsOverride = {}
  if (Object.prototype.hasOwnProperty.call(obj, 'trimOrder')) {
    if (!isValidTrimOrder(obj.trimOrder)) {
      return { ok: false, error: 'budget_trim_trim_order_invalid' }
    }
    patch.trimOrder = [...obj.trimOrder]
  }
  if (Object.prototype.hasOwnProperty.call(obj, 'minRetain')) {
    const mr = obj.minRetain
    if (!mr || typeof mr !== 'object' || Array.isArray(mr)) {
      return { ok: false, error: 'budget_trim_min_retain_invalid' }
    }
    const minPatch: Partial<BudgetTrimMinRetain> = {}
    for (const key of BUDGET_TRIM_SLOTS) {
      if (Object.prototype.hasOwnProperty.call(mr, key)) {
        const v = (mr as Record<string, unknown>)[key]
        if (typeof v !== 'number' || !Number.isFinite(v)) {
          return { ok: false, error: 'budget_trim_min_retain_number' }
        }
        minPatch[key] = v
      }
    }
    if (Object.keys(minPatch).length === 0) {
      return { ok: false, error: 'budget_trim_min_retain_requires_field' }
    }
    patch.minRetain = minPatch
  }
  if (Object.keys(patch).length === 0) {
    return { ok: false, error: 'budget_trim_settings_requires_field' }
  }
  return { ok: true, patch }
}
