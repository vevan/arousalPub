/** §14.4.1 预算裁切：全局 user-preferences + 会话稀疏覆盖 */

export type BudgetTrimSlot = 'knowledge' | 'lore' | 'memory' | 'history'

export const BUDGET_TRIM_SLOTS: readonly BudgetTrimSlot[] = [
  'knowledge',
  'lore',
  'memory',
  'history',
]

export interface BudgetTrimMinRetain {
  knowledge: number
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
  trimOrder: ['knowledge', 'lore', 'memory', 'history'],
  minRetain: { knowledge: 1, lore: 1, memory: 1, history: 1 },
}

export const MIN_RETAIN_MIN = 0
export const MIN_RETAIN_MAX = 32

const LEGACY_3: readonly BudgetTrimSlot[] = ['lore', 'memory', 'history']

function isTrimSlot(x: unknown): x is BudgetTrimSlot {
  return (
    x === 'knowledge' || x === 'lore' || x === 'memory' || x === 'history'
  )
}

/** 接受 4 槽全排列；旧 3 槽（无 knowledge）自动在队首补 knowledge */
export function normalizeTrimOrder(raw: unknown): BudgetTrimSlot[] {
  const defaults = [...BUDGET_TRIM_SETTINGS_DEFAULTS.trimOrder]
  if (!Array.isArray(raw)) return defaults

  if (raw.length === 3) {
    const seen = new Set<BudgetTrimSlot>()
    const out: BudgetTrimSlot[] = []
    for (const item of raw) {
      if (!isTrimSlot(item) || item === 'knowledge' || seen.has(item)) {
        return defaults
      }
      seen.add(item)
      out.push(item)
    }
    if (
      out.length === 3 &&
      LEGACY_3.every((s) => seen.has(s))
    ) {
      return ['knowledge', ...out]
    }
    return defaults
  }

  if (raw.length !== 4) return defaults
  const seen = new Set<BudgetTrimSlot>()
  const out: BudgetTrimSlot[] = []
  for (const item of raw) {
    if (!isTrimSlot(item) || seen.has(item)) return defaults
    seen.add(item)
    out.push(item)
  }
  if (out.length !== 4 || !BUDGET_TRIM_SLOTS.every((s) => seen.has(s))) {
    return defaults
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
    knowledge:
      minRaw && Object.prototype.hasOwnProperty.call(minRaw, 'knowledge')
        ? clampMinRetain(minRaw.knowledge, defaults.minRetain.knowledge)
        : defaults.minRetain.knowledge,
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
  return normalizeBudgetTrimSettings({
    trimOrder: override.trimOrder ?? g.trimOrder,
    minRetain: { ...g.minRetain, ...override.minRetain },
  })
}

export function budgetTrimSettingsOverrideFromEffective(
  effective: BudgetTrimSettings,
  global: BudgetTrimSettings,
): BudgetTrimSettingsOverride | null {
  const e = normalizeBudgetTrimSettings(effective)
  const g = normalizeBudgetTrimSettings(global)
  const o: BudgetTrimSettingsOverride = {}
  if (
    e.trimOrder.length !== g.trimOrder.length ||
    e.trimOrder.some((s, i) => s !== g.trimOrder[i])
  ) {
    o.trimOrder = [...e.trimOrder]
  }
  const min: Partial<BudgetTrimMinRetain> = {}
  if (e.minRetain.knowledge !== g.minRetain.knowledge) {
    min.knowledge = e.minRetain.knowledge
  }
  if (e.minRetain.lore !== g.minRetain.lore) min.lore = e.minRetain.lore
  if (e.minRetain.memory !== g.minRetain.memory) min.memory = e.minRetain.memory
  if (e.minRetain.history !== g.minRetain.history) {
    min.history = e.minRetain.history
  }
  if (Object.keys(min).length) o.minRetain = min
  return Object.keys(o).length > 0 ? o : null
}

export function budgetTrimSettingsEqual(
  a: BudgetTrimSettings,
  b: BudgetTrimSettings,
): boolean {
  if (a.minRetain.knowledge !== b.minRetain.knowledge) return false
  if (a.minRetain.lore !== b.minRetain.lore) return false
  if (a.minRetain.memory !== b.minRetain.memory) return false
  if (a.minRetain.history !== b.minRetain.history) return false
  if (a.trimOrder.length !== b.trimOrder.length) return false
  return a.trimOrder.every((s, i) => s === b.trimOrder[i])
}

export function isValidTrimOrder(raw: unknown): raw is BudgetTrimSlot[] {
  if (!Array.isArray(raw)) return false
  if (raw.length === 3) {
    const seen = new Set<BudgetTrimSlot>()
    for (const item of raw) {
      if (!isTrimSlot(item) || item === 'knowledge' || seen.has(item)) {
        return false
      }
      seen.add(item)
    }
    return LEGACY_3.every((s) => seen.has(s))
  }
  if (raw.length !== 4) return false
  const seen = new Set<BudgetTrimSlot>()
  for (const item of raw) {
    if (!isTrimSlot(item) || seen.has(item)) return false
    seen.add(item)
  }
  return BUDGET_TRIM_SLOTS.every((s) => seen.has(s))
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
):
  | { ok: true; patch: BudgetTrimSettingsOverride }
  | { ok: false; error: BudgetTrimPatchParseError } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'budget_trim_settings_invalid' }
  }
  const obj = raw as Record<string, unknown>
  const patch: BudgetTrimSettingsOverride = {}
  if (Object.prototype.hasOwnProperty.call(obj, 'trimOrder')) {
    if (!isValidTrimOrder(obj.trimOrder)) {
      return { ok: false, error: 'budget_trim_trim_order_invalid' }
    }
    patch.trimOrder = normalizeTrimOrder(obj.trimOrder)
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
