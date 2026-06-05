import type { MacroHandler } from '../types.js'

export const expandAuthorsNoteMacros: MacroHandler = (text, ctx) => {
  if (!text.includes('{{')) return text
  const note = ctx.authorsNote ?? ''
  return text.replace(/\{\{\s*authorsNote\s*\}\}/gi, () => note)
}
