/** 与 SillyTavern 等常见习惯对齐的占位符替换（大小写不敏感）；与 server/src/prompt-macros.ts 对齐 */

export interface PromptMacroContext {
  userName: string
  characterNames: string[]
}

const DEFAULT_USER_LABEL = '用户'
const DEFAULT_CHAR_LABEL = '角色'

export function buildPromptMacroContext(params: {
  conversationUserName?: string | null
  characters?: { name?: string }[]
}): PromptMacroContext {
  const raw = params.conversationUserName
  const userName =
    typeof raw === 'string' && raw.trim() ? raw.trim() : DEFAULT_USER_LABEL
  const characterNames = (params.characters ?? []).map((c, i) => {
    const n = c.name?.trim()
    if (n) return n
    return `${DEFAULT_CHAR_LABEL}${i + 1}`
  })
  return { userName, characterNames }
}

export function expandPromptMacros(
  text: string,
  ctx: PromptMacroContext,
): string {
  if (!text || !text.includes('{{')) return text
  let out = text
  out = out.replace(/\{\{\s*char\s*(\d+)\s*\}\}/gi, (_m, nStr) => {
    const n = Number.parseInt(String(nStr), 10)
    if (!Number.isFinite(n) || n < 1) return ''
    const i = n - 1
    const v = ctx.characterNames[i]?.trim()
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

/** 已知宏展开后，仍残留的 `{{...}}` 替换为 `[UNSET]`（含未闭合 `{{` 尾部） */
export function replaceUnsetMacroPlaceholders(text: string): string {
  if (!text || !text.includes('{{')) return text
  let out = text.replace(/\{\{[^}]+\}\}/g, '[UNSET]')
  out = out.replace(/\{\{[^}]*$/g, '[UNSET]')
  return out
}

/** 展开已知宏 → 清扫未定义占位符 */
export function applyPromptMacroPipeline(
  text: string,
  ctx: PromptMacroContext,
): string {
  return replaceUnsetMacroPlaceholders(expandPromptMacros(text, ctx))
}
