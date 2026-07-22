export type LorebookTriggerMode = 'keyword' | 'constant' | 'vector'

export type LorebookEntryPosition = 'before_char' | 'after_char'

/** 将关键字数组格式化为输入框展示（英文逗号 + 空格） */
export function formatLorebookKeysInput(keys: string[]): string {
  return keys.join(', ')
}

/** 从输入框解析关键字（支持 `,` / `，` 分隔） */
export function parseLorebookKeysInput(raw: string): string[] {
  return raw
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function resolveEntryTriggerMode(entry: {
  constant: boolean
  triggerMode?: LorebookTriggerMode
}): LorebookTriggerMode {
  const m = entry.triggerMode
  if (m === 'keyword' || m === 'constant' || m === 'vector') return m
  return entry.constant ? 'constant' : 'keyword'
}

export function resolveEntryPosition(entry: {
  position?: LorebookEntryPosition
}): LorebookEntryPosition {
  return entry.position === 'before_char' ? 'before_char' : 'after_char'
}

/** 关键字触发模式下是否缺少有效关键字 */
export function lorebookEntryMissingKeywords(entry: {
  constant: boolean
  triggerMode?: LorebookTriggerMode
  keys: string[]
}): boolean {
  if (resolveEntryTriggerMode(entry) !== 'keyword') return false
  return !entry.keys.some((k) => k.trim().length > 0)
}

export function entryKeysInputDisabled(entry: {
  constant: boolean
  triggerMode?: LorebookTriggerMode
}): boolean {
  const mode = resolveEntryTriggerMode(entry)
  return mode === 'constant' || mode === 'vector'
}

export function patchForTriggerMode(
  mode: LorebookTriggerMode,
): { triggerMode: LorebookTriggerMode; constant: boolean } {
  return {
    triggerMode: mode,
    constant: mode === 'constant',
  }
}
