import type { MacroHandler } from '../types.js'

export const expandConnectionMacros: MacroHandler = (text, ctx) => {
  if (!text.includes('{{')) return text
  let out = text
  const model = ctx.model?.trim() ?? ''
  out = out.replace(/\{\{\s*model\s*\}\}/gi, () => model)
  const ctxLen =
    typeof ctx.contextLength === 'number' &&
    !Number.isNaN(ctx.contextLength) &&
    ctx.contextLength > 0
      ? String(Math.floor(ctx.contextLength))
      : ''
  out = out.replace(/\{\{\s*maxprompt\s*\}\}/gi, () => ctxLen)
  out = out.replace(/\{\{\s*context\s*\}\}/gi, () => ctxLen)
  return out
}
