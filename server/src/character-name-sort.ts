import { pinyin } from 'pinyin-pro'

const LATIN_RE = /[A-Za-z]/
const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/

/**
 * 名称排序分桶：0 拉丁开头 → 1 汉字开头 → 2 其它。
 * 使 `vevan` 排在 `可可`（keke）前，同时中文仍按拼音序。
 */
function leadingScriptBucket(name: string): number {
  const t = name.trim()
  if (!t) return 2
  for (const ch of t) {
    if (LATIN_RE.test(ch)) return 0
    if (CJK_RE.test(ch)) return 1
  }
  return 2
}

/** 中文转无声调拼音；拉丁/符号保留，整串小写后用于 en 比较 */
export function characterNameSortKey(name: string): string {
  const t = name.trim()
  if (!t) return ''
  const py = pinyin(t, { toneType: 'none', separator: '', nonZh: 'consecutive' })
  return (py || t).toLowerCase()
}

/** 角色卡名称升序比较（降序时对返回值取反） */
export function compareCharacterNamesAsc(a: string, b: string): number {
  const ba = leadingScriptBucket(a)
  const bb = leadingScriptBucket(b)
  if (ba !== bb) return ba - bb

  const byKey = characterNameSortKey(a).localeCompare(
    characterNameSortKey(b),
    'en',
    { sensitivity: 'base', numeric: true },
  )
  if (byKey !== 0) return byKey

  return a.trim().localeCompare(b.trim(), 'zh-CN')
}
