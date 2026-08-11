export type SettingsSection =
  | 'bindings'
  | 'api'
  | 'lore'
  | 'context'
  | 'vectorRecall'
  | 'budgetTrim'
  | 'authorsNote'
  | 'regexApply'
  | 'plugins'

export interface CharItem {
  id: string
  name: string
}

export interface LorebookItem {
  id: string
  name: string
}

export type LoreRecursionDepth = 0 | 1 | 2 | 3
