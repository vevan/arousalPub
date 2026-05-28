import type { MacroHandler, PromptMacroContext } from '../types.js'

const DEFAULT_CHAR_LABEL = '角色'
const DEFAULT_USER_LABEL = '用户'

export const expandUserCharMacros: MacroHandler = (text, ctx) => {
  if (!text.includes('{{')) return text
  let out = text
  out = out.replace(/\{\{\s*char\s*(\d+)\s*\}\}/gi, (_m, nStr) => {
    const n = Number.parseInt(String(nStr), 10)
    if (!Number.isFinite(n) || n < 1) return ''
    const v = ctx.characterNames[n - 1]?.trim()
    return v ?? ''
  })
  out = out.replace(/\{\{\s*char\s*\}\}/gi, () => {
    const v = ctx.characterNames[0]?.trim()
    return v ?? DEFAULT_CHAR_LABEL
  })
  out = out.replace(/\{\{\s*user\s*\}\}/gi, () => {
    const u = ctx.userName.trim()
    return u || DEFAULT_USER_LABEL
  })
  return out
}
