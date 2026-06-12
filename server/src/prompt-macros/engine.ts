import { renderPromptMacrosCst } from './cst/render.js'
import type { PromptMacroContext } from './types.js'

export { renderPromptMacrosCst } from './cst/render.js'

/** 提示词宏展开（CST） */
export function renderPromptMacros(
  text: string,
  ctx: PromptMacroContext,
): string {
  return renderPromptMacrosCst(text, ctx)
}
