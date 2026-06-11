import { renderPromptMacros } from './handlebars-engine.js'
import type { PromptMacroContext } from './types.js'

const MACRO_HINT = /\{\{|<(?:USER|BOT|CHAR)>/i

export function messageNeedsMacroExpansion(text: string): boolean {
  return Boolean(text && MACRO_HINT.test(text))
}

export function applyPromptMacroPipeline(
  text: string,
  ctx: PromptMacroContext,
): string {
  if (!text) return text
  if (!messageNeedsMacroExpansion(text)) return text
  return renderPromptMacros(text, ctx)
}

export function applyMacrosToMessages(
  messages: { role: string; content: string }[],
  ctx: PromptMacroContext,
  opts?: { onlyIfNeeded?: boolean },
): void {
  const onlyIfNeeded = opts?.onlyIfNeeded === true
  for (const m of messages) {
    if (onlyIfNeeded && !messageNeedsMacroExpansion(m.content)) continue
    m.content = applyPromptMacroPipeline(m.content, ctx)
  }
}
