import type { MacroHandler } from '../types.js'

export const expandNewlineMacros: MacroHandler = (text) => {
  if (!text.includes('{{')) return text
  return text.replace(/\{\{\s*newline\s*\}\}/gi, '\n')
}
