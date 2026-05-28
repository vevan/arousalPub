import type { MacroHandler } from '../types.js'

/** 已知宏展开后，残留 `{{...}}` → `[UNSET]` */
export const replaceUnsetMacroPlaceholders: MacroHandler = (text) => {
  if (!text.includes('{{')) return text
  let out = text.replace(/\{\{[^}]+\}\}/g, '[UNSET]')
  out = out.replace(/\{\{[^}]*$/g, '[UNSET]')
  return out
}
