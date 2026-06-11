import { preprocessLegacyAngleTags } from '../preprocess.js'
import type { PromptMacroContext } from '../types.js'
import { parseMacroDocument } from './parser.js'
import { walkCstDocument } from './walker.js'

/** CST 宏引擎：Lexer → Parser → Walker */
export function renderPromptMacrosCst(
  text: string,
  ctx: PromptMacroContext,
): string {
  if (!text) return text
  const normalized = preprocessLegacyAngleTags(text)
  if (!normalized.includes('{{') && !normalized.includes('\\')) return normalized
  return walkCstDocument(parseMacroDocument(normalized), ctx)
}
