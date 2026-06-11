import { resolveMacroEngine } from '../config.js'
import { renderPromptMacrosCst } from './cst/render.js'
import { renderPromptMacrosLegacy } from './handlebars-engine.js'
import type { PromptMacroContext } from './types.js'

export type { MacroEngineId } from '../config.js'
export { resolveMacroEngine } from '../config.js'
export { renderPromptMacrosCst } from './cst/render.js'

export function renderPromptMacros(
  text: string,
  ctx: PromptMacroContext,
): string {
  if (resolveMacroEngine() === 'cst') {
    return renderPromptMacrosCst(text, ctx)
  }
  return renderPromptMacrosLegacy(text, ctx)
}
