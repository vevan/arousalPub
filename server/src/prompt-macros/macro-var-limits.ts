import type { MacroVarMap } from './macro-vars.js'

/** 单会话 / 全局变量 map 最大键数 */
export const MACRO_VAR_MAX_KEYS = 256

/** 单变量值最大字符数 */
export const MACRO_VAR_MAX_VALUE_LENGTH = 65_536

export function clampMacroVarValue(value: string): string {
  if (value.length <= MACRO_VAR_MAX_VALUE_LENGTH) return value
  return value.slice(0, MACRO_VAR_MAX_VALUE_LENGTH)
}

/** 读盘 / 写盘前规范化变量 map（键 trim、数量与单值长度上限） */
export function sanitizeMacroVarMap(
  src?: MacroVarMap | null,
): MacroVarMap {
  if (!src || typeof src !== 'object') return {}
  const out: MacroVarMap = {}
  for (const [k, v] of Object.entries(src)) {
    if (typeof k !== 'string' || !k.trim() || typeof v !== 'string') continue
    if (Object.keys(out).length >= MACRO_VAR_MAX_KEYS) break
    out[k.trim()] = clampMacroVarValue(v)
  }
  return out
}
