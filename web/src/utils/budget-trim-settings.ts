/** 与 server/src/budget-trim-settings.ts 对齐（Web 展示用） */

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

export function cloneBudgetTrimSettings(s: BudgetTrimSettings): BudgetTrimSettings {
  return {
    trimOrder: [...s.trimOrder],
    minRetain: { ...s.minRetain },
  }
}
