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

/** 关键字触发模式下是否缺少有效关键字（此类条目不会参与注入） */
export function lorebookEntryMissingKeywords(entry: {
  constant: boolean
  keys: string[]
}): boolean {
  if (entry.constant) return false
  return !entry.keys.some((k) => k.trim().length > 0)
}
