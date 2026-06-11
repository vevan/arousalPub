import { renderPromptMacros } from './handlebars-engine.js'
import type { PromptMacroContext } from './types.js'

export function applyPromptMacroPipeline(
  text: string,
  ctx: PromptMacroContext,
): string {
  if (!text) return text
  if (!text.includes('{{') && !/<(USER|BOT|CHAR)>/i.test(text)) return text
  return renderPromptMacros(text, ctx)
}

export function applyMacrosToMessages(
  messages: { role: string; content: string }[],
  ctx: PromptMacroContext,
): void {
  for (const m of messages) {
    m.content = applyPromptMacroPipeline(m.content, ctx)
  }
}
