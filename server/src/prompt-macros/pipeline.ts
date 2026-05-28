import { MACRO_HANDLERS } from './handlers/index.js'
import type { PromptMacroContext } from './types.js'

export function applyPromptMacroPipeline(
  text: string,
  ctx: PromptMacroContext,
): string {
  if (!text || !text.includes('{{')) return text
  let out = text
  for (const h of MACRO_HANDLERS) {
    out = h(out, ctx)
  }
  return out
}

export function applyMacrosToMessages(
  messages: { role: string; content: string }[],
  ctx: PromptMacroContext,
): void {
  for (const m of messages) {
    m.content = applyPromptMacroPipeline(m.content, ctx)
  }
}
