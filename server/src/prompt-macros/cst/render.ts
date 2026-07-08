import type { PromptMacroContext } from '../types.js'
import { getCachedMacroDocument } from './document-cache.js'
import { walkCstDocument } from './walker.js'

function textHasNoArgTrim(text: string): boolean {
  return /\{\{\s*trim\s*\}\}/i.test(text) && !/\{\{\s*trim\s*::/i.test(text)
}

function renderPromptMacrosCstOnce(
  text: string,
  ctx: PromptMacroContext,
): string {
  if (!text) return text
  const normalized = text
  if (!normalized.includes('{{') && !normalized.includes('\\')) return normalized
  return walkCstDocument(getCachedMacroDocument(normalized), ctx)
}

/** CST 宏引擎：Lexer → Parser → Walker */
export function renderPromptMacrosCst(
  text: string,
  ctx: PromptMacroContext,
): string {
  if (!textHasNoArgTrim(text)) {
    return renderPromptMacrosCstOnce(text, ctx)
  }
  const parts = text.split(/\{\{\s*trim\s*\}\}/i)
  let out = ''
  for (let i = 0; i < parts.length; i++) {
    out += renderPromptMacrosCstOnce(parts[i]!, ctx)
    if (i < parts.length - 1) out = out.trimEnd()
  }
  return out
}
