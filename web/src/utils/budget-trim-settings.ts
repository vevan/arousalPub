/** 与 server/src/budget-trim-settings.ts 对齐（Web 展示用） */

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
    if (out.length === 3 && LEGACY_3.every((s) => seen.has(s))) {
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

export function cloneBudgetTrimSettings(s: BudgetTrimSettings): BudgetTrimSettings {
  return {
    trimOrder: [...s.trimOrder],
    minRetain: { ...s.minRetain },
  }
}
