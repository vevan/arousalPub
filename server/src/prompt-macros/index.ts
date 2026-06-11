export type { PromptMacroContext } from './types.js'
export type { MacroCharacterFields } from './character-fields.js'
export { extractMacroCharacterFields } from './character-fields.js'
export { buildPromptMacroContext } from './context.js'
export type { MacroContextCharacterInput } from './context.js'
export {
  applyPromptMacroPipeline,
  applyMacrosToMessages,
} from './pipeline.js'
export { clearMacroTemplateCache } from './handlebars-engine.js'
